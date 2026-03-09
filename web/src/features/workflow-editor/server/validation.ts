import { z } from "zod/v4";

// Field mapping for data flow between nodes
export const FieldMappingSchema = z.object({
  sourceField: z.string(), // e.g., "node_1.output" or "node_1.output.topic"
  targetVariable: z.string(), // e.g., "topic"
  mappingType: z.enum(["full", "field"]),
});

// Retry configuration for node execution
export const RetryConfigSchema = z.object({
  maxRetries: z.number().int().min(0).max(5).default(0),
  retryDelay: z.number().int().min(0).max(30000).default(1000), // ms
});

// Model parameters for LLM execution
export const ModelParamsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  adapter: z.string(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  max_completion_tokens: z.number().optional(),
});

// --- Edge condition schemas ---

// Single condition
export const EdgeConditionSchema = z.object({
  field: z.string(),
  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "regex_match",
    "greater_than",
    "less_than",
    "is_empty",
    "is_not_empty",
  ]),
  value: z.string().optional(),
});

// Compound condition group (AND/OR logic) - uses z.lazy for recursion
export const EdgeConditionGroupSchema: z.ZodType<{
  logic: "and" | "or";
  conditions: unknown[];
}> = z.object({
  logic: z.enum(["and", "or"]),
  conditions: z
    .lazy(() =>
      z.array(z.union([EdgeConditionSchema, EdgeConditionGroupSchema])),
    )
    .pipe(z.array(z.any()).min(1)),
});

// Combined: single condition or compound group
export const EdgeConditionExprSchema = z.union([
  EdgeConditionSchema,
  EdgeConditionGroupSchema,
]);

// Node data configuration
export const WorkflowNodeDataSchema = z.object({
  label: z.string().min(1),
  // Prompt reference (from Langfuse Prompt Management)
  promptId: z.string().optional(),
  promptVersion: z.number().optional(),
  // Inline messages (ChatMessage[])
  messages: z.array(z.any()).optional(),
  // Model configuration
  modelParams: ModelParamsSchema.optional(),
  // Tools and structured output
  tools: z.array(z.any()).optional(), // PlaygroundTool[]
  structuredOutputSchema: z.any().optional(), // PlaygroundSchema
  // Data flow configuration
  inputMapping: z.array(FieldMappingSchema).optional(),
  outputMapping: z.array(FieldMappingSchema).optional(),
  // Error handling
  retryConfig: RetryConfigSchema.optional(),
  // Router-specific fields (optional at schema level, cross-validated in WorkflowNodeDefSchema)
  routeField: z.string().optional(),
  // Shared workflow context keys
  contextReads: z.array(z.string()).optional(),
  contextWrites: z.array(z.string()).optional(),
  // Execution mode
  executionMode: z.enum(["llm", "tool", "passthrough"]).optional(),
  // Tool configuration (for executionMode === "tool")
  toolType: z.string().optional(),
  toolConfig: z.record(z.string(), z.unknown()).optional(),
});

// Node definition (matches ReactFlow Node structure)
export const WorkflowNodeDefSchema = z
  .object({
    id: z.string(),
    type: z.enum(["agent", "input", "output", "router"]),
    position: z.object({ x: z.number(), y: z.number() }),
    data: WorkflowNodeDataSchema,
  })
  .refine(
    (node) => {
      const d = node.data as Record<string, unknown>;
      if (node.type === "router") {
        if (!d.routeField || typeof d.routeField !== "string") return false;
        if (
          d.messages ||
          d.modelParams ||
          d.tools ||
          d.structuredOutputSchema ||
          d.retryConfig
        )
          return false;
      }
      if (node.type === "agent") {
        if (d.routeField) return false;
      }
      if (node.type === "input" || node.type === "output") {
        if (d.routeField || d.messages || d.modelParams) return false;
      }
      return true;
    },
    { message: "Node data fields are inconsistent with node type" },
  );

// Edge definition (matches ReactFlow Edge structure)
export const WorkflowEdgeDefSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  // New fields -- all optional for backward compat with edges that have no `data`
  data: z
    .object({
      edgeType: z.enum(["default", "conditional", "loop"]).default("default"),
      condition: EdgeConditionExprSchema.optional(),
      conditionLabel: z.string().optional(),
      maxIterations: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
});

// Complete workflow definition (graph structure)
export const WorkflowDefinitionSchema = z.object({
  nodes: z.array(WorkflowNodeDefSchema),
  edges: z.array(WorkflowEdgeDefSchema),
});

// Workflow name validation (alphanumeric, spaces, hyphens, periods, underscores)
export const WorkflowNameSchema = z
  .string()
  .min(1, "Name is required")
  .max(100, "Name must be less than 100 characters")
  .regex(
    /^[a-zA-Z0-9\._\- ]+$/,
    "Name must contain only alphanumeric letters, spaces, hyphens, periods and underscores",
  );

// Create workflow input
export const CreateWorkflowInput = z.object({
  projectId: z.string(),
  name: WorkflowNameSchema,
  description: z.string().max(500).optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  definition: WorkflowDefinitionSchema,
  inputSchema: z.any().optional(), // JSON Schema for workflow inputs
});

// Update workflow input (creates a new version)
export const UpdateWorkflowInput = z.object({
  id: z.string(),
  projectId: z.string(),
  name: WorkflowNameSchema,
  description: z.string().max(500).optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  definition: WorkflowDefinitionSchema,
  inputSchema: z.any().optional(),
});

// Delete workflow input
export const DeleteWorkflowInput = z.object({
  id: z.string(),
  projectId: z.string(),
});

// Get workflow by ID input
export const GetWorkflowByIdInput = z.object({
  id: z.string(),
  projectId: z.string(),
});

// Get workflow by name input
export const GetWorkflowByNameInput = z.object({
  projectId: z.string(),
  name: z.string(),
  version: z.number().optional(), // If not provided, get latest version
});

// Get all workflows input
export const GetAllWorkflowsInput = z.object({
  projectId: z.string(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

// Save execution results input
export const SaveExecutionResultsInput = z.object({
  projectId: z.string(),
  workflowId: z.string(),
  results: z.array(
    z.object({
      nodeId: z.string(),
      output: z.string(),
    }),
  ),
  status: z.enum(["success", "error", "pending"]),
  timestamp: z.number(),
});
