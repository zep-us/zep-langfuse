/**
 * MCP Tool: deleteWorkflow
 *
 * Deletes a workflow (or specific version) from Langfuse.
 * Destructive operation.
 */

import { z } from "zod/v4";
import { defineTool } from "../../../core/define-tool";
import { prisma } from "@langfuse/shared/src/db";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { instrumentAsync } from "@langfuse/shared/src/server";
import { SpanKind } from "@opentelemetry/api";
import { WorkflowNameSchema } from "@/src/features/workflow-editor/server/validation";
import { UserInputError } from "../../../core/errors";

/**
 * Base schema for JSON Schema generation (MCP client display)
 */
const DeleteWorkflowBaseSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe("The name of the workflow to delete"),
  version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Specific version to delete. If omitted, ALL versions of this workflow are deleted.",
    ),
});

/**
 * Input schema for runtime validation
 */
const DeleteWorkflowInputSchema = z.object({
  name: WorkflowNameSchema,
  version: z.number().int().positive().optional(),
});

/**
 * deleteWorkflow tool definition and handler
 */
export const [deleteWorkflowTool, handleDeleteWorkflow] = defineTool({
  name: "deleteWorkflow",
  description: [
    "Delete a workflow from Langfuse.",
    "",
    "Important:",
    "- If version is provided, only that specific version is deleted",
    "- If version is omitted, ALL versions of the workflow are deleted",
    "- This operation is irreversible",
    "",
    "Accepts: name (required), version (optional)",
  ].join("\n"),
  baseSchema: DeleteWorkflowBaseSchema,
  inputSchema: DeleteWorkflowInputSchema,
  destructiveHint: true,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.delete", spanKind: SpanKind.INTERNAL },
      async (span) => {
        span.setAttributes({
          "langfuse.project.id": context.projectId,
          "langfuse.org.id": context.orgId,
          "mcp.api_key_id": context.apiKeyId,
          "mcp.workflow_name": input.name,
        });

        // Find workflows to delete
        const workflowsToDelete = await prisma.workflow.findMany({
          where: {
            projectId: context.projectId,
            name: input.name,
            ...(input.version !== undefined ? { version: input.version } : {}),
          },
        });

        if (workflowsToDelete.length === 0) {
          const versionSuffix =
            input.version !== undefined ? ` version ${input.version}` : "";
          throw new UserInputError(
            `Workflow '${input.name}'${versionSuffix} not found in this project`,
          );
        }

        // Delete all matched workflow records
        const { count } = await prisma.workflow.deleteMany({
          where: {
            projectId: context.projectId,
            name: input.name,
            ...(input.version !== undefined ? { version: input.version } : {}),
          },
        });

        span.setAttribute("mcp.deleted_count", count);

        // Audit log each deleted workflow
        for (const workflow of workflowsToDelete) {
          await auditLog({
            action: "delete",
            resourceType: "workflow",
            resourceId: workflow.id,
            projectId: context.projectId,
            orgId: context.orgId,
            apiKeyId: context.apiKeyId,
            before: workflow,
          });
        }

        const versionSuffix =
          input.version !== undefined
            ? ` version ${input.version}`
            : ` (${count} version${count !== 1 ? "s" : ""})`;

        return {
          message: `Successfully deleted workflow '${input.name}'${versionSuffix}`,
          deletedCount: count,
        };
      },
    );
  },
});
