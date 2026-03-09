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
});

/**
 * connectNodes tool definition and handler
 */
export const [connectNodesTool, handleConnectNodes] = defineTool({
  name: "connectNodes",
  description: [
    "Add a directed edge between two existing nodes in a workflow.",
    "",
    "Important:",
    "- Both source and target nodes must already exist in the workflow",
    "- Workflows are immutable - this creates a new version",
    "- Edge ID is auto-generated",
    "- Use sourceHandle/targetHandle if the nodes expose multiple connection points",
    "",
    "Accepts: workflowName, sourceNodeId, targetNodeId, optional sourceHandle, optional targetHandle",
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

        // Build new edge with auto-generated ID
        const edgeId = `edge-${sourceNodeId}-${targetNodeId}-${Date.now()}`;
        const newEdge: WorkflowEdgeShape = {
          id: edgeId,
          source: sourceNodeId,
          target: targetNodeId,
          ...(sourceHandle ? { sourceHandle } : {}),
          ...(targetHandle ? { targetHandle } : {}),
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
