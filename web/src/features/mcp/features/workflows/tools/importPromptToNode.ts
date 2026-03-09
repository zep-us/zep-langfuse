/**
 * MCP Tool: importPromptToNode
 *
 * Imports a registered Langfuse prompt (by name) into a workflow agent node.
 * Fetches the prompt, extracts messages and config, and applies them to the node.
 * Creates a new workflow version.
 */

import { z } from "zod/v4";
import { defineTool } from "../../../core/define-tool";
import { ParamWorkflowName } from "../validation";
import {
  ParamPromptName,
  ParamPromptLabel,
  ParamPromptVersion,
} from "../../prompts/validation";
import { UserInputError } from "../../../core/errors";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { instrumentAsync } from "@langfuse/shared/src/server";
import { SpanKind } from "@opentelemetry/api";
import { getPromptByName } from "@/src/features/prompts/server/actions/getPromptByName";
import {
  fetchLatestWorkflow,
  saveAsNewVersion,
  type WorkflowDefinitionShape,
  type WorkflowNodeShape,
} from "./_helpers";

/**
 * Base schema for importPromptToNode tool
 */
const ImportPromptToNodeBaseSchema = z.object({
  workflowName: ParamWorkflowName,
  nodeId: z
    .string()
    .min(1)
    .describe("The ID of the agent node to import the prompt into"),
  promptName: ParamPromptName,
  promptLabel: ParamPromptLabel,
  promptVersion: ParamPromptVersion,
  applyConfig: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Whether to apply the prompt's config (model parameters) to the node. Default: true",
    ),
});

/**
 * Full input schema with runtime validations
 */
const ImportPromptToNodeInputSchema = ImportPromptToNodeBaseSchema.refine(
  (data) => !(data.promptLabel && data.promptVersion),
  {
    message:
      "Cannot specify both promptLabel and promptVersion - they are mutually exclusive",
  },
);

/**
 * importPromptToNode tool definition and handler
 */
export const [importPromptToNodeTool, handleImportPromptToNode] = defineTool({
  name: "importPromptToNode",
  description: [
    "Import a registered Langfuse prompt into a workflow agent node.",
    "",
    "This fetches a prompt from Langfuse's Prompt Management by name and applies",
    "its messages and optionally its config (model parameters) to the specified agent node.",
    "",
    "Prompt resolution:",
    "- promptLabel: Get prompt with specific label (e.g., 'production', 'staging')",
    "- promptVersion: Get specific version number (e.g., 1, 2, 3)",
    "- neither: Returns 'production' version by default",
    "",
    "What gets applied:",
    "- messages: The prompt's chat messages (system, user, assistant) replace existing messages",
    "- config: If applyConfig=true, the prompt's config (provider, model, temperature, etc.) is applied as modelParams",
    "- promptId and promptVersion: Stored on the node as a reference back to the source prompt",
    "",
    "Important:",
    "- Only works on 'agent' nodes (not input, output, or router)",
    "- Only 'chat' type prompts can be imported (not 'text')",
    "- Workflows are immutable - this creates a new version",
    "- promptLabel and promptVersion are mutually exclusive",
    "",
    "Accepts: workflowName, nodeId, promptName, promptLabel?, promptVersion?, applyConfig?",
  ].join("\n"),
  baseSchema: ImportPromptToNodeBaseSchema,
  inputSchema: ImportPromptToNodeInputSchema,
  handler: async (input, context) => {
    return await instrumentAsync(
      {
        name: "mcp.workflows.import_prompt_to_node",
        spanKind: SpanKind.INTERNAL,
      },
      async (span) => {
        const {
          workflowName,
          nodeId,
          promptName,
          promptLabel,
          promptVersion,
          applyConfig,
        } = input;

        span.setAttributes({
          "langfuse.project.id": context.projectId,
          "langfuse.org.id": context.orgId,
          "mcp.api_key_id": context.apiKeyId,
          "mcp.workflow_name": workflowName,
          "mcp.node_id": nodeId,
          "mcp.prompt_name": promptName,
        });

        // 1. Fetch the prompt from Langfuse
        const prompt = await getPromptByName({
          promptName,
          projectId: context.projectId,
          label: promptLabel,
          version: promptVersion,
        });

        if (!prompt) {
          throw new UserInputError(
            `Prompt '${promptName}' not found${promptLabel ? ` with label '${promptLabel}'` : ""}${promptVersion ? ` with version ${promptVersion}` : ""}`,
          );
        }

        if (prompt.type !== "chat") {
          throw new UserInputError(
            `Prompt '${promptName}' is of type '${prompt.type}'. Only 'chat' type prompts can be imported into workflow nodes.`,
          );
        }

        // Extract messages from prompt
        const messages = Array.isArray(prompt.prompt)
          ? (prompt.prompt as Array<{ role: string; content: string }>)
          : [];

        if (messages.length === 0) {
          throw new UserInputError(
            `Prompt '${promptName}' has no messages to import.`,
          );
        }

        // 2. Fetch the latest workflow version
        const workflow = await fetchLatestWorkflow(
          context.projectId,
          workflowName,
        );

        const definition =
          workflow.definition as unknown as WorkflowDefinitionShape;

        // 3. Find and validate the target node
        const nodeIndex = definition.nodes.findIndex(
          (n: WorkflowNodeShape) => n.id === nodeId,
        );
        if (nodeIndex === -1) {
          throw new UserInputError(
            `Node '${nodeId}' not found in workflow '${workflowName}'`,
          );
        }

        const node = definition.nodes[nodeIndex];
        if (node.type !== "agent") {
          throw new UserInputError(
            `Node '${nodeId}' is of type '${node.type}'. importPromptToNode only works on 'agent' nodes.`,
          );
        }

        // 4. Build updated node data
        const updatedData: Record<string, unknown> = {
          ...node.data,
          messages,
          promptId: prompt.id,
          promptVersion: prompt.version,
        };

        // Apply config as modelParams if requested
        if (applyConfig && prompt.config) {
          const config = prompt.config as Record<string, unknown>;
          // Map prompt config to modelParams structure
          if (Object.keys(config).length > 0) {
            updatedData.modelParams = {
              ...(node.data.modelParams as Record<string, unknown> | undefined),
              ...config,
            };
          }
        }

        const updatedNode: WorkflowNodeShape = {
          ...node,
          data: updatedData,
        };

        const updatedDefinition: WorkflowDefinitionShape = {
          ...definition,
          nodes: definition.nodes.map((n: WorkflowNodeShape, i: number) =>
            i === nodeIndex ? updatedNode : n,
          ),
        };

        const before = workflow;

        // 5. Save as new version
        const newWorkflow = await saveAsNewVersion({
          projectId: context.projectId,
          name: workflow.name,
          description: workflow.description,
          tags: workflow.tags,
          definition: updatedDefinition,
          inputSchema: workflow.inputSchema,
          currentVersion: workflow.version,
        });

        span.setAttribute("mcp.new_version", newWorkflow.version);

        await auditLog({
          action: "update",
          resourceType: "workflow",
          resourceId: newWorkflow.id,
          projectId: context.projectId,
          orgId: context.orgId,
          apiKeyId: context.apiKeyId,
          before,
          after: newWorkflow,
        });

        return {
          id: newWorkflow.id,
          name: newWorkflow.name,
          version: newWorkflow.version,
          nodeId,
          promptName: prompt.name,
          promptVersion: prompt.version,
          promptId: prompt.id,
          messagesCount: messages.length,
          configApplied:
            applyConfig &&
            Object.keys((prompt.config as object) ?? {}).length > 0,
          message: `Successfully imported prompt '${promptName}' (v${prompt.version}) into node '${nodeId}' in workflow '${workflowName}' (new version: ${newWorkflow.version})`,
        };
      },
    );
  },
});
