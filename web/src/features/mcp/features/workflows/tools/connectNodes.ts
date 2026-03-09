/**
 * MCP Tool: connectNodes
 *
 * Adds a directed edge between two existing nodes in a workflow.
 * Fetches the latest version, appends the edge, saves as a new version.
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
  type WorkflowEdgeShape,
} from "./_helpers";

/**
 * Base schema for connectNodes tool
 */
const EdgeConditionSchema = z.object({
  field: z
    .string()
    .describe("JSON path in upstream output, e.g. 'output.category'"),
  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "regex_match",
    "greater_than",
    "less_than",
    "is_empty",
    "is_not_empty",
  ]),
  value: z.string().optional().describe("Comparison value"),
});

const EdgeConditionGroupSchema: z.ZodType<{
  logic: "and" | "or";
  conditions: unknown[];
}> = z.object({
  logic: z.enum(["and", "or"]),
  conditions: z.lazy(() =>
    z.array(z.union([EdgeConditionSchema, EdgeConditionGroupSchema])),
  ),
});

const EdgeConditionExprSchema = z.union([
  EdgeConditionSchema,
  EdgeConditionGroupSchema,
]);

const ConnectNodesBaseSchema = z.object({
  workflowName: ParamWorkflowName,
  sourceNodeId: z
    .string()
    .min(1)
    .describe("The ID of the source node (edge originates here)"),
  targetNodeId: z
    .string()
    .min(1)
    .describe("The ID of the target node (edge terminates here)"),
  sourceHandle: z
    .string()
    .optional()
    .describe("Optional handle ID on the source node"),
  targetHandle: z
    .string()
    .optional()
    .describe("Optional handle ID on the target node"),
  edgeType: z
    .enum(["default", "conditional", "loop"])
    .optional()
    .default("default")
    .describe(
      "Edge type: 'default' (unconditional), 'conditional' (router branch), 'loop' (back-edge with iteration limit)",
    ),
  condition: EdgeConditionExprSchema.optional().describe(
    "Condition for conditional edges. Single: {field, operator, value}. Compound: {logic: 'and'|'or', conditions: [...]}",
  ),
  conditionLabel: z
    .string()
    .optional()
    .describe(
      "Human-readable label for the condition, e.g. 'category = sports'",
    ),
  maxIterations: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max iterations for loop edges (default 10, max 100)"),
});

/**
 * connectNodes tool definition and handler
 */
export const [connectNodesTool, handleConnectNodes] = defineTool({
  name: "connectNodes",
  description: [
    "Add a directed edge between two existing nodes in a workflow.",
    "",
    "Edge types:",
    "- 'default': Unconditional edge (standard data flow)",
    "- 'conditional': Conditional edge from a router node. Requires 'condition' parameter.",
    "- 'loop': Back-edge for creating loops. Source must be a router node. Optional 'maxIterations' (default 10).",
    "",
    "Important:",
    "- Both source and target nodes must already exist in the workflow",
    "- Workflows are immutable - this creates a new version",
    "- Edge ID is auto-generated",
    "- Use sourceHandle/targetHandle if the nodes expose multiple connection points",
    "- Conditional edges require a condition (single or compound AND/OR)",
    "- Loop edges source must be a router node",
    "",
    "Accepts: workflowName, sourceNodeId, targetNodeId, edgeType, condition, conditionLabel, maxIterations",
  ].join("\n"),
  baseSchema: ConnectNodesBaseSchema,
  inputSchema: ConnectNodesBaseSchema,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.connect_nodes", spanKind: SpanKind.INTERNAL },
      async (span) => {
        const {
          workflowName,
          sourceNodeId,
          targetNodeId,
          sourceHandle,
          targetHandle,
          edgeType,
          condition,
          conditionLabel,
          maxIterations,
        } = input;

        // Set span attributes for observability
        span.setAttributes({
          "langfuse.project.id": context.projectId,
          "langfuse.org.id": context.orgId,
          "mcp.api_key_id": context.apiKeyId,
          "mcp.workflow_name": workflowName,
          "mcp.source_node_id": sourceNodeId,
          "mcp.target_node_id": targetNodeId,
        });

        // Fetch the latest workflow version
        const workflow = await fetchLatestWorkflow(
          context.projectId,
          workflowName,
        );

        const definition =
          workflow.definition as unknown as WorkflowDefinitionShape;

        // Validate that both nodes exist
        const sourceExists = definition.nodes.some(
          (n) => n.id === sourceNodeId,
        );
        if (!sourceExists) {
          throw new UserInputError(
            `Source node '${sourceNodeId}' not found in workflow '${workflowName}'`,
          );
        }

        const targetExists = definition.nodes.some(
          (n) => n.id === targetNodeId,
        );
        if (!targetExists) {
          throw new UserInputError(
            `Target node '${targetNodeId}' not found in workflow '${workflowName}'`,
          );
        }

        // Validate edge type constraints
        if (edgeType === "conditional" && !condition) {
          throw new UserInputError(
            "Conditional edges require a 'condition' parameter",
          );
        }
        const sourceNode = definition.nodes.find((n) => n.id === sourceNodeId);
        // Validate no adjacent routers
        const targetNode = definition.nodes.find((n) => n.id === targetNodeId);
        if (
          sourceNode?.type === "router" &&
          targetNode?.type === "router" &&
          edgeType !== "loop"
        ) {
          throw new UserInputError(
            "Direct router-to-router connections are not allowed. Place an agent node in between.",
          );
        }

        // Build new edge with auto-generated ID
        const edgeId = `edge-${sourceNodeId}-${targetNodeId}-${Date.now()}`;
        const edgeData: Record<string, unknown> = { edgeType };
        if (condition) edgeData.condition = condition;
        if (conditionLabel) edgeData.conditionLabel = conditionLabel;
        if (maxIterations !== undefined) edgeData.maxIterations = maxIterations;

        const newEdge: WorkflowEdgeShape = {
          id: edgeId,
          source: sourceNodeId,
          target: targetNodeId,
          ...(sourceHandle ? { sourceHandle } : {}),
          ...(targetHandle ? { targetHandle } : {}),
          ...(edgeType !== "default" ? { data: edgeData } : {}),
        };

        const updatedDefinition: WorkflowDefinitionShape = {
          ...definition,
          edges: [...definition.edges, newEdge],
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
          addedEdge: newEdge,
          message: `Successfully connected '${sourceNodeId}' → '${targetNodeId}' in workflow '${workflowName}' (new version: ${newWorkflow.version})`,
        };
      },
    );
  },
});
