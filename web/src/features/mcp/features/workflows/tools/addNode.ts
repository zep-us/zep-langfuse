/**
 * MCP Tool: addNode
 *
 * Adds a new node to a workflow definition.
 * Fetches the latest version, appends the node, saves as a new version.
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
} from "./_helpers";

/**
 * Base schema for addNode tool
 */
const AddNodeBaseSchema = z.object({
  workflowName: ParamWorkflowName,
  nodeType: z
    .enum(["agent", "input", "output"])
    .describe("The type of node to add"),
  nodeId: z
    .string()
    .min(1)
    .describe("Unique ID for the new node (must be unique within workflow)"),
  label: z.string().min(1).describe("Display label for the node"),
  position: z
    .object({
      x: z.number().describe("X coordinate on the canvas"),
      y: z.number().describe("Y coordinate on the canvas"),
    })
    .describe("Position of the node on the workflow canvas"),
  config: z
    .object({
      messages: z
        .array(
          z.object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string(),
          }),
        )
        .optional()
        .describe("Initial prompt messages (agent nodes only)"),
      modelParams: z
        .object({
          provider: z.string(),
          model: z.string(),
          adapter: z.string(),
          temperature: z.number().optional(),
          max_tokens: z.number().optional(),
          top_p: z.number().optional(),
        })
        .optional()
        .describe("Model parameters (agent nodes only)"),
    })
    .optional()
    .describe("Optional configuration for the node (used for agent nodes)"),
});

/**
 * addNode tool definition and handler
 */
export const [addNodeTool, handleAddNode] = defineTool({
  name: "addNode",
  description: [
    "Add a new node to a workflow.",
    "",
    "Node types:",
    "- 'agent': LLM agent node - accepts messages and modelParams in config",
    "- 'input': Workflow input node - receives external inputs",
    "- 'output': Workflow output node - produces final results",
    "",
    "Important:",
    "- nodeId must be unique within the workflow",
    "- Workflows are immutable - this creates a new version",
    "- Use connectNodes to wire the new node into the graph",
    "",
    "Accepts: workflowName, nodeType, nodeId, label, position ({x, y}), optional config",
  ].join("\n"),
  baseSchema: AddNodeBaseSchema,
  inputSchema: AddNodeBaseSchema,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.add_node", spanKind: SpanKind.INTERNAL },
      async (span) => {
        const { workflowName, nodeType, nodeId, label, position, config } =
          input;

        // Set span attributes for observability
        span.setAttributes({
          "langfuse.project.id": context.projectId,
          "langfuse.org.id": context.orgId,
          "mcp.api_key_id": context.apiKeyId,
          "mcp.workflow_name": workflowName,
          "mcp.node_id": nodeId,
          "mcp.node_type": nodeType,
        });

        // Fetch the latest workflow version
        const workflow = await fetchLatestWorkflow(
          context.projectId,
          workflowName,
        );

        const definition =
          workflow.definition as unknown as WorkflowDefinitionShape;

        // Ensure nodeId is unique
        const exists = definition.nodes.some((n) => n.id === nodeId);
        if (exists) {
          throw new UserInputError(
            `A node with id '${nodeId}' already exists in workflow '${workflowName}'`,
          );
        }

        // Build new node data
        const nodeData: Record<string, unknown> = { label };
        if (nodeType === "agent" && config) {
          if (config.messages) nodeData.messages = config.messages;
          if (config.modelParams) nodeData.modelParams = config.modelParams;
        }

        const newNode = {
          id: nodeId,
          type: nodeType,
          position,
          data: nodeData,
        };

        const updatedDefinition: WorkflowDefinitionShape = {
          ...definition,
          nodes: [...definition.nodes, newNode],
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
          addedNode: newNode,
          message: `Successfully added ${nodeType} node '${nodeId}' to workflow '${workflowName}' (new version: ${newWorkflow.version})`,
        };
      },
    );
  },
});
