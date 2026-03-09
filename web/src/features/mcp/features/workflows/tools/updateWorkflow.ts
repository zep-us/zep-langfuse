/**
 * MCP Tool: updateWorkflow
 *
 * Creates a new version of an existing workflow in Langfuse.
 * Workflows use immutable versioning - updating creates a new version.
 */

import { z } from "zod/v4";
import { defineTool } from "../../../core/define-tool";
import { Prisma } from "@langfuse/shared";
import { prisma } from "@langfuse/shared/src/db";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { instrumentAsync } from "@langfuse/shared/src/server";
import { SpanKind } from "@opentelemetry/api";
import {
  WorkflowDefinitionSchema,
  WorkflowNameSchema,
} from "@/src/features/workflow-editor/server/validation";

/**
 * Base schema for JSON Schema generation (MCP client display)
 */
const UpdateWorkflowBaseSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe("The name of the workflow to update"),
  description: z
    .string()
    .max(500)
    .optional()
    .describe("Optional description of the workflow"),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Optional tags for organization (e.g., ['production', 'experimental'])",
    ),
  definition: z
    .object({
      nodes: z.array(z.any()),
      edges: z.array(z.any()),
    })
    .describe("Updated workflow graph definition with nodes and edges"),
  inputSchema: z
    .any()
    .optional()
    .describe("Optional JSON Schema for workflow inputs"),
});

/**
 * Input schema for runtime validation
 */
const UpdateWorkflowInputSchema = z.object({
  name: WorkflowNameSchema,
  description: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
  definition: WorkflowDefinitionSchema,
  inputSchema: z.any().optional(),
});

/**
 * updateWorkflow tool definition and handler
 */
export const [updateWorkflowTool, handleUpdateWorkflow] = defineTool({
  name: "updateWorkflow",
  description: [
    "Update a workflow in Langfuse by creating a new version.",
    "",
    "Important:",
    "- Workflows are immutable - updating creates a new version (version + 1)",
    "- The workflow is identified by name; the latest version becomes the basis",
    "- All fields in the new version must be provided (not a partial update)",
    "- Node types: 'agent', 'input', 'output'",
    "",
    "Accepts: name, definition (nodes + edges), optional description, tags, inputSchema",
  ].join("\n"),
  baseSchema: UpdateWorkflowBaseSchema,
  inputSchema: UpdateWorkflowInputSchema,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.update", spanKind: SpanKind.INTERNAL },
      async (span) => {
        span.setAttributes({
          "langfuse.project.id": context.projectId,
          "langfuse.org.id": context.orgId,
          "mcp.api_key_id": context.apiKeyId,
          "mcp.workflow_name": input.name,
        });

        // Get the latest existing version for audit log (before state)
        const existingWorkflow = await prisma.workflow.findFirst({
          where: {
            projectId: context.projectId,
            name: input.name,
          },
          orderBy: { version: "desc" },
        });

        // Determine next version number
        const nextVersion =
          existingWorkflow !== null ? existingWorkflow.version + 1 : 1;

        // Create a new version (immutable versioning)
        const newWorkflow = await prisma.workflow.create({
          data: {
            projectId: context.projectId,
            createdBy: "API",
            name: input.name,
            description: input.description ?? "",
            version: nextVersion,
            tags: input.tags ?? [],
            definition: input.definition as Prisma.InputJsonValue,
            inputSchema: input.inputSchema as Prisma.InputJsonValue | undefined,
          },
        });

        span.setAttribute("mcp.new_version", newWorkflow.version);

        await auditLog({
          action: "update",
          resourceType: "workflow",
          resourceId: newWorkflow.id,
          projectId: context.projectId,
          orgId: context.orgId,
          apiKeyId: context.apiKeyId,
          before: existingWorkflow ?? undefined,
          after: newWorkflow,
        });

        return {
          id: newWorkflow.id,
          name: newWorkflow.name,
          version: newWorkflow.version,
          description: newWorkflow.description,
          tags: newWorkflow.tags,
          createdAt: newWorkflow.createdAt,
          createdBy: newWorkflow.createdBy,
          message: `Successfully updated workflow '${newWorkflow.name}' to version ${newWorkflow.version}`,
        };
      },
    );
  },
});
