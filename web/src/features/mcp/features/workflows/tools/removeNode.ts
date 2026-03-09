/**
 * MCP Tool: removeNode
 *
 * Removes a node and all its connected edges from a workflow.
 * Fetches the latest version, filters out the node and edges, saves as new version.
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
 * Base schema for removeNode tool
 */
const RemoveNodeBaseSchema = z.object({
  workflowName: ParamWorkflowName,
  nodeId: z.string().min(1).describe("The ID of the node to remove"),
});

/**
 * removeNode tool definition and handler
 */
export const [removeNodeTool, handleRemoveNode] = defineTool({
  name: "removeNode",
  description: [
    "Remove a node and all its connected edges from a workflow.",
    "",
    "Important:",
    "- This also removes all edges where the node is source or target",
    "- Workflows are immutable - this creates a new version",
    "- This operation cannot be undone (previous version still accessible by version number)",
  ].join("\n"),
  baseSchema: RemoveNodeBaseSchema,
  inputSchema: RemoveNodeBaseSchema,
  destructiveHint: true,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.remove_node", spanKind: SpanKind.INTERNAL },
      async (span) => {
        const { workflowName, nodeId } = input;

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

        // Verify the node exists
        const nodeExists = definition.nodes.some((n) => n.id === nodeId);
        if (!nodeExists) {
          throw new UserInputError(
            `Node '${nodeId}' not found in workflow '${workflowName}'`,
          );
        }

        // Remove the node and all connected edges
        const removedEdgeIds: string[] = [];
        const updatedEdges = definition.edges.filter((e: WorkflowEdgeShape) => {
          const connected = e.source === nodeId || e.target === nodeId;
          if (connected) removedEdgeIds.push(e.id);
          return !connected;
        });

        const updatedDefinition: WorkflowDefinitionShape = {
          nodes: definition.nodes.filter((n) => n.id !== nodeId),
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
          removedNodeId: nodeId,
          removedEdgeIds,
          message: `Successfully removed node '${nodeId}' and ${removedEdgeIds.length} connected edge(s) from workflow '${workflowName}' (new version: ${newWorkflow.version})`,
        };
      },
    );
  },
});
