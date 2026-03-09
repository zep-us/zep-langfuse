/**
 * MCP Tool: updateNodePrompt
 *
 * Updates the prompt messages of a specific agent node in a workflow.
 * Fetches the latest version, modifies in memory, saves as a new version.
 */

import { z } from "zod/v4";
import { defineTool } from "../../../core/define-tool";
import { ParamWorkflowName } from "../validation";
import { UserInputError } from "../../../core/errors";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { instrumentAsync } from "@langfuse/shared/src/server";
import { SpanKind } from "@opentelemetry/api";
import {
  fetchLatestWorkflow,
  saveAsNewVersion,
  type WorkflowDefinitionShape,
  type WorkflowNodeShape,
} from "./_helpers";

/**
 * Base schema for updateNodePrompt tool
 */
const UpdateNodePromptBaseSchema = z.object({
  workflowName: ParamWorkflowName,
  nodeId: z.string().min(1).describe("The ID of the agent node to update"),
  messages: z
    .array(
      z.object({
        role: z
          .enum(["system", "user", "assistant"])
          .describe("The role of the message sender"),
        content: z.string().describe("The message content"),
      }),
    )
    .min(1)
    .describe("The new prompt messages to set on the node"),
});

/**
 * updateNodePrompt tool definition and handler
 */
export const [updateNodePromptTool, handleUpdateNodePrompt] = defineTool({
  name: "updateNodePrompt",
  description: [
    "Update the prompt messages of a specific agent node in a workflow.",
    "",
    "Important:",
    "- Only works on nodes with type 'agent'",
    "- Workflows are immutable - this creates a new version",
    "- Provide the full messages array (replaces existing messages)",
    "",
    "Accepts: workflowName, nodeId, messages (array of {role, content} objects)",
  ].join("\n"),
  baseSchema: UpdateNodePromptBaseSchema,
  inputSchema: UpdateNodePromptBaseSchema,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.update_node_prompt", spanKind: SpanKind.INTERNAL },
      async (span) => {
        const { workflowName, nodeId, messages } = input;

        // Set span attributes for observability
        span.setAttributes({
          "langfuse.project.id": context.projectId,
          "langfuse.org.id": context.orgId,
          "mcp.api_key_id": context.apiKeyId,
          "mcp.workflow_name": workflowName,
          "mcp.node_id": nodeId,
        });

        // Fetch the latest workflow version
        const workflow = await fetchLatestWorkflow(
          context.projectId,
          workflowName,
        );

        const definition =
          workflow.definition as unknown as WorkflowDefinitionShape;

        // Find the target node
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
            `Node '${nodeId}' is of type '${node.type}', but updateNodePrompt only works on 'agent' nodes`,
          );
        }

        // Update messages in memory
        const updatedNode: WorkflowNodeShape = {
          ...node,
          data: { ...node.data, messages },
        };

        const updatedDefinition: WorkflowDefinitionShape = {
          ...definition,
          nodes: definition.nodes.map((n: WorkflowNodeShape, i: number) =>
            i === nodeIndex ? updatedNode : n,
          ),
        };

        const before = workflow;

        // Save as new version
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
          messagesCount: messages.length,
          message: `Successfully updated prompt messages on node '${nodeId}' in workflow '${workflowName}' (new version: ${newWorkflow.version})`,
        };
      },
    );
  },
});
