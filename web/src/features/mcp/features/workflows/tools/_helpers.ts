/**
 * Shared helpers for workflow node-level MCP tools
 *
 * Provides fetch and save primitives used by all node/edge mutation tools.
 */

import { prisma } from "@langfuse/shared/src/db";
import { Prisma } from "@langfuse/shared";
import { UserInputError } from "../../../core/errors";

export interface WorkflowNodeShape {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdgeShape {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowDefinitionShape {
  nodes: WorkflowNodeShape[];
  edges: WorkflowEdgeShape[];
}

/**
 * Fetch the latest workflow version by name within a project.
 * Throws if not found.
 */
export async function fetchLatestWorkflow(
  projectId: string,
  workflowName: string,
) {
  const workflow = await prisma.workflow.findFirst({
    where: { projectId, name: workflowName },
    orderBy: { version: "desc" },
  });

  if (!workflow) {
    throw new UserInputError(`Workflow '${workflowName}' not found`);
  }

  return workflow;
}

/**
 * Save a modified workflow definition as a new immutable version.
 */
export async function saveAsNewVersion(params: {
  projectId: string;
  name: string;
  description: string;
  tags: string[];
  definition: WorkflowDefinitionShape;
  inputSchema?: unknown;
  currentVersion: number;
}) {
  return prisma.workflow.create({
    data: {
      projectId: params.projectId,
      createdBy: "API",
      name: params.name,
      description: params.description,
      version: params.currentVersion + 1,
      tags: params.tags,
      definition: params.definition as unknown as Prisma.InputJsonValue,
      inputSchema:
        params.inputSchema !== undefined
          ? (params.inputSchema as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });
}
