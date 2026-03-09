/**
 * MCP Tool: listWorkflows
 *
 * Lists workflows in the project with pagination.
 * Read-only operation.
 */

import { z } from "zod/v4";
import { defineTool } from "../../../core/define-tool";
import { ParamLimit } from "../../../core/validation";
import { prisma } from "@langfuse/shared/src/db";
import { instrumentAsync } from "@langfuse/shared/src/server";
import { SpanKind } from "@opentelemetry/api";

const ParamOffset = z.coerce
  .number()
  .int()
  .min(0)
  .default(0)
  .describe("Number of items to skip for pagination (default: 0)");

/**
 * Base schema for listWorkflows tool
 */
const ListWorkflowsBaseSchema = z.object({
  limit: ParamLimit,
  offset: ParamOffset,
});

/**
 * listWorkflows tool definition and handler
 */
export const [listWorkflowsTool, handleListWorkflows] = defineTool({
  name: "listWorkflows",
  description: [
    "List workflows in the project. Returns the latest version of each workflow with metadata.",
    "",
    "Pagination: limit (default: 50, max: 100), offset (default: 0)",
  ].join("\n"),
  baseSchema: ListWorkflowsBaseSchema,
  inputSchema: ListWorkflowsBaseSchema,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.list", spanKind: SpanKind.INTERNAL },
      async (span) => {
        const { limit, offset } = input;

        // Set span attributes for observability
        span.setAttributes({
          "langfuse.project.id": context.projectId,
          "langfuse.org.id": context.orgId,
          "mcp.api_key_id": context.apiKeyId,
          "mcp.pagination_limit": limit,
          "mcp.pagination_offset": offset,
        });

        // Get all workflows for the project, ordered to allow deduplication by name
        const allWorkflows = await prisma.workflow.findMany({
          where: { projectId: context.projectId },
          orderBy: [
            { name: "asc" },
            { version: "desc" },
            { updatedAt: "desc" },
          ],
          select: {
            id: true,
            name: true,
            description: true,
            version: true,
            tags: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        // Get latest version of each workflow (DISTINCT ON name)
        const workflowsByName = new Map<string, (typeof allWorkflows)[0]>();
        for (const workflow of allWorkflows) {
          if (!workflowsByName.has(workflow.name)) {
            workflowsByName.set(workflow.name, workflow);
          }
        }

        const workflows = Array.from(workflowsByName.values()).slice(
          offset,
          offset + limit,
        );

        // Set result count for observability
        span.setAttribute("mcp.result_count", workflows.length);

        // Return formatted response
        return {
          data: workflows.map((w) => ({
            id: w.id,
            name: w.name,
            description: w.description,
            version: w.version,
            tags: w.tags,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          })),
          pagination: {
            limit,
            offset,
            totalItems: workflowsByName.size,
          },
        };
      },
    );
  },
  readOnlyHint: true,
});
