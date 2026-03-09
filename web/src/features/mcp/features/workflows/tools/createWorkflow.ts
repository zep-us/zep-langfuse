/**
 * MCP Tool: createWorkflow
 *
 * Creates a new workflow version in Langfuse.
 * Write operation.
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
 * Uses simple types that serialize well to JSON Schema
 */
const CreateWorkflowBaseSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "The name of the workflow (alphanumeric, spaces, hyphens, periods, underscores)",
    ),
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
    .describe("Workflow graph definition with nodes and edges"),
  inputSchema: z
    .any()
    .optional()
    .describe("Optional JSON Schema for workflow inputs"),
});

/**
 * Input schema for runtime validation
 * Uses full validation schemas from workflow-editor
 */
const CreateWorkflowInputSchema = z.object({
  name: WorkflowNameSchema,
  description: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
  definition: WorkflowDefinitionSchema,
  inputSchema: z.any().optional(),
});

/**
 * createWorkflow tool definition and handler
 */
export const [createWorkflowTool, handleCreateWorkflow] = defineTool({
  name: "createWorkflow",
  description: [
    "Create a new workflow in Langfuse.",
    "",
    "Important:",
    "- Workflows use immutable versioning - each create/update creates a new version",
    "- If a workflow with this name already exists, a new version is created",
    "- The definition must include nodes and edges arrays",
    "- Node types: 'agent', 'input', 'output'",
    "",
    "Accepts: name, definition (nodes + edges), optional description, tags, inputSchema",
  ].join("\n"),
  baseSchema: CreateWorkflowBaseSchema,
  inputSchema: CreateWorkflowInputSchema,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.create", spanKind: SpanKind.INTERNAL },
      async (span) => {
        span.setAttributes({
          "langfuse.project.id": context.projectId,
          "langfuse.org.id": context.orgId,
          "mcp.api_key_id": context.apiKeyId,
          "mcp.workflow_name": input.name,
        });

        // Determine version number (find highest version for this name + 1)
        const existingWorkflows = await prisma.workflow.findMany({
          where: {
            projectId: context.projectId,
            name: input.name,
          },
          select: { version: true },
          orderBy: { version: "desc" },
          take: 1,
        });

        const nextVersion =
          existingWorkflows.length > 0 ? existingWorkflows[0]!.version + 1 : 1;

        const workflow = await prisma.workflow.create({
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

        span.setAttribute("mcp.created_version", workflow.version);

        await auditLog({
          action: "create",
          resourceType: "workflow",
          resourceId: workflow.id,
          projectId: context.projectId,
          orgId: context.orgId,
          apiKeyId: context.apiKeyId,
          after: workflow,
        });

        return {
          id: workflow.id,
          name: workflow.name,
          version: workflow.version,
          description: workflow.description,
          tags: workflow.tags,
          createdAt: workflow.createdAt,
          createdBy: workflow.createdBy,
          message: `Successfully created workflow '${workflow.name}' version ${workflow.version}`,
        };
      },
    );
  },
});
