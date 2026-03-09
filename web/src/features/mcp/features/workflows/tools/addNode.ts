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
    .enum(["agent", "input", "output", "router"])
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
      routeField: z
        .string()
        .optional()
        .describe(
          "JSON path to evaluate in upstream output (router nodes only), e.g. 'output.category'",
        ),
      executionMode: z
        .enum(["llm", "tool", "passthrough"])
        .optional()
        .describe(
          "Execution mode for agent nodes: 'llm' (default), 'tool', or 'passthrough'",
        ),
      contextReads: z
        .array(z.string())
        .optional()
        .describe("Keys to read from shared workflow context"),
      contextWrites: z
        .array(z.string())
        .optional()
        .describe("Keys to write to shared workflow context"),
    })
    .optional()
    .describe(
      "Optional configuration for the node (agent: messages, modelParams, executionMode; router: routeField)",
    ),
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
    "- 'agent': LLM agent node - accepts messages, modelParams, executionMode, contextReads, contextWrites in config",
    "- 'input': Workflow input node - receives external inputs",
    "- 'output': Workflow output node - produces final results",
    "- 'router': Conditional routing node - accepts routeField in config. Pure control-flow, no LLM call.",
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
          if (config.executionMode)
            nodeData.executionMode = config.executionMode;
          if (config.contextReads) nodeData.contextReads = config.contextReads;
          if (config.contextWrites)
            nodeData.contextWrites = config.contextWrites;
        }
        if (nodeType === "router" && config) {
          if (!config.routeField) {
            throw new UserInputError(
              "Router nodes require 'routeField' in config",
            );
          }
          nodeData.routeField = config.routeField;
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
