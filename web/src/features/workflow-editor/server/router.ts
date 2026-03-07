import { Prisma } from "@langfuse/shared";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { TRPCError } from "@trpc/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { logger } from "@langfuse/shared/src/server";
import type { ChatMessage } from "@langfuse/shared";
import {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  DeleteWorkflowInput,
  GetWorkflowByIdInput,
  GetWorkflowByNameInput,
  GetAllWorkflowsInput,
} from "./validation";

export const workflowRouter = createTRPCRouter({
  create: protectedProjectProcedure
    .input(CreateWorkflowInput)
    .mutation(async ({ input, ctx }) => {
      try {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "workflows:CUD",
        });

        // Determine version number (find highest version for this name + 1)
        const existingWorkflows = await ctx.prisma.workflow.findMany({
          where: {
            projectId: input.projectId,
            name: input.name,
          },
          select: { version: true },
          orderBy: { version: "desc" },
          take: 1,
        });

        const nextVersion =
          existingWorkflows.length > 0 ? existingWorkflows[0]!.version + 1 : 1;

        const workflow = await ctx.prisma.workflow.create({
          data: {
            projectId: input.projectId,
            createdBy: ctx.session.user.id,
            name: input.name,
            description: input.description ?? "",
            version: nextVersion,
            tags: input.tags ?? [],
            definition: input.definition as Prisma.InputJsonValue,
            inputSchema: input.inputSchema as Prisma.InputJsonValue | undefined,
          },
        });

        await auditLog({
          session: ctx.session,
          resourceType: "workflow",
          resourceId: workflow.id,
          action: "create",
          after: workflow,
        });

        return workflow;
      } catch (error) {
        logger.error("Failed to create workflow", error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Creating workflow failed",
        });
      }
    }),

  getAll: protectedProjectProcedure
    .input(GetAllWorkflowsInput)
    .query(async ({ input, ctx }) => {
      try {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "workflows:read",
        });

        // Get latest version of each workflow name
        // Using DISTINCT ON pattern
        const workflows = await ctx.prisma.$queryRaw<
          Array<{
            id: string;
            created_at: Date;
            updated_at: Date;
            project_id: string;
            created_by: string;
            name: string;
            description: string;
            version: number;
            tags: string[];
            definition: Prisma.JsonValue;
            input_schema: Prisma.JsonValue | null;
          }>
        >(
          Prisma.sql`
            SELECT DISTINCT ON (name)
              id,
              created_at,
              updated_at,
              project_id,
              created_by,
              name,
              description,
              version,
              tags,
              definition,
              input_schema
            FROM workflows
            WHERE project_id = ${input.projectId}
            ORDER BY name, version DESC, updated_at DESC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
          `,
        );

        return workflows.map((w) => ({
          id: w.id,
          createdAt: w.created_at,
          updatedAt: w.updated_at,
          projectId: w.project_id,
          createdBy: w.created_by,
          name: w.name,
          description: w.description,
          version: w.version,
          tags: w.tags,
          definition: w.definition,
          inputSchema: w.input_schema,
        }));
      } catch (error) {
        logger.error("Failed to get workflows", error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Getting workflows failed",
        });
      }
    }),

  getById: protectedProjectProcedure
    .input(GetWorkflowByIdInput)
    .query(async ({ input, ctx }) => {
      try {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "workflows:read",
        });

        const workflow = await ctx.prisma.workflow.findUnique({
          where: {
            id: input.id,
            projectId: input.projectId,
          },
        });

        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        return workflow;
      } catch (error) {
        logger.error("Failed to get workflow by ID", error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Getting workflow failed",
        });
      }
    }),

  getByName: protectedProjectProcedure
    .input(GetWorkflowByNameInput)
    .query(async ({ input, ctx }) => {
      try {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "workflows:read",
        });

        // If version is provided, get that specific version
        // Otherwise, get the latest version
        const workflow = await ctx.prisma.workflow.findFirst({
          where: {
            projectId: input.projectId,
            name: input.name,
            ...(input.version ? { version: input.version } : {}),
          },
          orderBy: input.version ? undefined : { version: "desc" },
        });

        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        return workflow;
      } catch (error) {
        logger.error("Failed to get workflow by name", error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Getting workflow failed",
        });
      }
    }),

  update: protectedProjectProcedure
    .input(UpdateWorkflowInput)
    .mutation(async ({ input, ctx }) => {
      try {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "workflows:CUD",
        });

        // Get the existing workflow for audit log
        const existingWorkflow = await ctx.prisma.workflow.findUnique({
          where: { id: input.id },
        });

        if (!existingWorkflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        if (existingWorkflow.projectId !== input.projectId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Workflow does not belong to this project",
          });
        }

        // Determine next version number
        const workflows = await ctx.prisma.workflow.findMany({
          where: {
            projectId: input.projectId,
            name: input.name,
          },
          select: { version: true },
          orderBy: { version: "desc" },
          take: 1,
        });

        const nextVersion =
          workflows.length > 0 ? workflows[0]!.version + 1 : 1;

        // Create a new version (immutable versioning like Prompt)
        const newWorkflow = await ctx.prisma.workflow.create({
          data: {
            projectId: input.projectId,
            createdBy: ctx.session.user.id,
            name: input.name,
            description: input.description ?? "",
            version: nextVersion,
            tags: input.tags ?? [],
            definition: input.definition as Prisma.InputJsonValue,
            inputSchema: input.inputSchema as Prisma.InputJsonValue | undefined,
          },
        });

        await auditLog({
          session: ctx.session,
          resourceType: "workflow",
          resourceId: newWorkflow.id,
          action: "update",
          before: existingWorkflow,
          after: newWorkflow,
        });

        return newWorkflow;
      } catch (error) {
        logger.error("Failed to update workflow", error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Updating workflow failed",
        });
      }
    }),

  delete: protectedProjectProcedure
    .input(DeleteWorkflowInput)
    .mutation(async ({ input, ctx }) => {
      try {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "workflows:CUD",
        });

        const workflow = await ctx.prisma.workflow.findUnique({
          where: { id: input.id },
        });

        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        if (workflow.projectId !== input.projectId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Workflow does not belong to this project",
          });
        }

        await ctx.prisma.workflow.delete({
          where: { id: input.id },
        });

        await auditLog({
          session: ctx.session,
          resourceType: "workflow",
          resourceId: workflow.id,
          action: "delete",
          before: workflow,
        });

        return { success: true };
      } catch (error) {
        logger.error("Failed to delete workflow", error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Deleting workflow failed",
        });
      }
    }),

  execute: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        messages: z.array(z.any()),
        modelParams: z.any(),
        tools: z.array(z.any()).optional(),
        structuredOutputSchema: z.any().optional(),
        streaming: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "workflows:CUD",
        });

        const { fetchLLMCompletion, LLMApiKeySchema } = await import(
          "@langfuse/shared/src/server"
        );
        const { PosthogCallbackHandler } = await import(
          "@/src/features/playground/server/analytics/posthogCallback"
        );

        const LLMApiKey = await ctx.prisma.llmApiKeys.findFirst({
          where: {
            projectId: input.projectId,
            provider: input.modelParams.provider,
          },
        });

        if (!LLMApiKey) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `No ${input.modelParams.provider} API key found in project. Please add one in the project settings.`,
          });
        }

        const parsedKey = LLMApiKeySchema.safeParse(LLMApiKey);
        if (!parsedKey.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not parse API key for provider ${input.modelParams.provider}: ${parsedKey.error.message}`,
          });
        }

        const fetchLLMCompletionParams = {
          projectId: input.projectId,
          llmConnection: parsedKey.data,
          messages: input.messages,
          modelParams: input.modelParams,
          streaming: input.streaming,
          structuredOutputSchema: input.structuredOutputSchema,
          callbacks: [
            new PosthogCallbackHandler("workflow", input, ctx.session.user.id),
          ],
        };

        if (input.structuredOutputSchema) {
          const result = await fetchLLMCompletion({
            ...fetchLLMCompletionParams,
            streaming: false,
            structuredOutputSchema: input.structuredOutputSchema,
          });
          return result;
        }

        const hasToolResults = input.messages.some(
          (msg: ChatMessage) => msg.type === "tool-result",
        );

        if ((input.tools && input.tools.length > 0) || hasToolResults) {
          const fixedMessages = input.messages.map((msg: ChatMessage) => {
            if (
              msg.type === "tool-result" &&
              (!msg.toolCallId || msg.toolCallId === "")
            ) {
              const assistantMessages = input.messages
                .filter(
                  (m: ChatMessage) =>
                    m.type === "assistant-tool-call" && "toolCalls" in m,
                )
                .reverse();

              for (const prevMsg of assistantMessages) {
                if (
                  prevMsg.type === "assistant-tool-call" &&
                  "toolCalls" in prevMsg
                ) {
                  // _originalRole is a custom property that may be set on tool-result messages
                  const originalRole =
                    "_originalRole" in msg
                      ? (msg as { _originalRole?: string })._originalRole
                      : undefined;
                  const matchingToolCall = prevMsg.toolCalls.find(
                    (tc) => tc.name === originalRole,
                  );
                  if (matchingToolCall && matchingToolCall.id) {
                    return {
                      ...msg,
                      toolCallId: matchingToolCall.id,
                    };
                  }
                }
              }
            }
            return msg;
          });

          const result = await fetchLLMCompletion({
            ...fetchLLMCompletionParams,
            messages: fixedMessages,
            streaming: false,
            tools: input.tools ?? [],
          });
          return result;
        }

        const completion = await fetchLLMCompletion({
          ...fetchLLMCompletionParams,
          streaming: false,
        });

        if (typeof completion === "string") {
          return { content: completion };
        } else {
          return {
            content: completion.text,
            reasoning: completion.reasoning,
          };
        }
      } catch (error) {
        logger.error("Failed to execute workflow node", error);

        // Re-throw TRPCErrors as-is
        if (error instanceof TRPCError) {
          throw error;
        }

        // Handle OpenAI SDK and other API errors with status codes
        if (error instanceof Error) {
          const statusCode =
            (error as any)?.response?.status ?? (error as any)?.status;
          const errorMessage = error.message || "Workflow execution failed";

          // Map HTTP status codes to appropriate TRPC error codes
          if (statusCode === 401 || statusCode === 403) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: `Authentication failed: ${errorMessage}. Please check your API key and IP restrictions.`,
            });
          }

          if (statusCode === 429) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: `Rate limit exceeded: ${errorMessage}. Please try again later.`,
            });
          }

          if (statusCode === 400) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Invalid request: ${errorMessage}`,
            });
          }

          // For other errors, include the status code in the message if available
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: statusCode
              ? `API Error (${statusCode}): ${errorMessage}`
              : errorMessage,
          });
        }

        // Fallback for non-Error objects
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Workflow execution failed with an unknown error",
        });
      }
    }),
});
