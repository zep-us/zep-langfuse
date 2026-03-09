/**
 * MCP Tool: getWorkflow
 *
 * Fetches a specific workflow by name with optional version.
 * Read-only operation.
 */

import { z } from "zod/v4";
import { defineTool } from "../../../core/define-tool";
import { ParamWorkflowName, ParamWorkflowVersion } from "../validation";
import { UserInputError } from "../../../core/errors";
import { prisma } from "@langfuse/shared/src/db";
import { instrumentAsync } from "@langfuse/shared/src/server";
import { SpanKind } from "@opentelemetry/api";

/**
 * Base schema for getWorkflow tool
 */
const GetWorkflowBaseSchema = z.object({
  name: ParamWorkflowName,
  version: ParamWorkflowVersion,
});

/**
 * getWorkflow tool definition and handler
 */
export const [getWorkflowTool, handleGetWorkflow] = defineTool({
  name: "getWorkflow",
  description: [
    "Fetch a specific workflow by name with optional version parameter.",
    "",
    "Retrieval options:",
    "- version: Get specific version number (e.g., 1, 2, 3)",
    "- neither: Returns the latest version by default",
    "",
    "Returns full workflow including definition (nodes and edges) and metadata.",
  ].join("\n"),
  baseSchema: GetWorkflowBaseSchema,
  inputSchema: GetWorkflowBaseSchema,
  handler: async (input, context) => {
    return await instrumentAsync(
      { name: "mcp.workflows.get", spanKind: SpanKind.INTERNAL },
      async (span) => {
        const { name, version } = input;

        // Set span attributes for observability
        span.setAttributes({
          "langfuse.project.id": context.projectId,
          "langfuse.org.id": context.orgId,
          "mcp.api_key_id": context.apiKeyId,
          "mcp.workflow_name": name,
        });

        if (version) {
          span.setAttribute("mcp.workflow_version", version);
        }

        // If version is provided, get that specific version; otherwise get latest
        const workflow = await prisma.workflow.findFirst({
          where: {
            projectId: context.projectId, // Auto-injected from authenticated API key
            name,
            ...(version ? { version } : {}),
          },
          orderBy: version ? undefined : { version: "desc" },
        });

        if (!workflow) {
          throw new UserInputError(
            `Workflow '${name}' not found${version ? ` with version ${version}` : ""}`,
          );
        }

        // Return formatted response with full definition
        return {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          version: workflow.version,
          tags: workflow.tags,
          definition: workflow.definition,
          inputSchema: workflow.inputSchema,
          createdAt: workflow.createdAt,
          updatedAt: workflow.updatedAt,
          createdBy: workflow.createdBy,
          projectId: workflow.projectId,
        };
      },
    );
  },
  readOnlyHint: true,
});
