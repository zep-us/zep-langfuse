/**
 * MCP Tool: disconnectNodes
 *
 * Removes the edge(s) between two nodes in a workflow.
 * Fetches the latest version, filters out matching edges, saves as a new version.
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
 * Base schema for disconnectNodes tool
 */
const DisconnectNodesBaseSchema = z.object({
  workflowName: ParamWorkflowName,
  sourceNodeId: z
    .string()
    .min(1)
    .describe("The ID of the source node of the edge to remove"),
  targetNodeId: z
    .string()
    .min(1)
    .describe("The ID of the target node of the edge to remove"),
});

/**
 * disconnectNodes tool definition and handler
 */
export const [disconnectNodesTool, handleDisconnectNodes] = defineTool({
  name: "disconnectNodes",
  description: [
    "Remove the edge(s) between two nodes in a workflow.",
    "",
    "Important:",
    "- Removes all edges where source matches sourceNodeId AND target matches targetNodeId",
    "- Workflows are immutable - this creates a new version",
    "- This operation cannot be undone (previous version still accessible by version number)",
    "",
    "Accepts: workflowName, sourceNodeId, targetNodeId",
  ].join("\n"),
  baseSchema: DisconnectNodesBaseSchema,
  inputSchema: DisconnectNodesBaseSchema,
  destructiveHint: true,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.disconnect_nodes", spanKind: SpanKind.INTERNAL },
      async (span) => {
        const { workflowName, sourceNodeId, targetNodeId } = input;

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

        // Find matching edges to remove
        const removedEdgeIds: string[] = [];
        const updatedEdges = definition.edges.filter((e: WorkflowEdgeShape) => {
          const matches =
            e.source === sourceNodeId && e.target === targetNodeId;
          if (matches) removedEdgeIds.push(e.id);
          return !matches;
        });

        if (removedEdgeIds.length === 0) {
          throw new UserInputError(
            `No edge found from '${sourceNodeId}' to '${targetNodeId}' in workflow '${workflowName}'`,
          );
        }

        const updatedDefinition: WorkflowDefinitionShape = {
          ...definition,
          edges: updatedEdges,
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
          removedEdgeIds,
          message: `Successfully removed ${removedEdgeIds.length} edge(s) from '${sourceNodeId}' → '${targetNodeId}' in workflow '${workflowName}' (new version: ${newWorkflow.version})`,
        };
      },
    );
  },
});
