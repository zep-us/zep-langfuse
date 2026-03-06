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
});

// Node definition (matches ReactFlow Node structure)
export const WorkflowNodeDefSchema = z.object({
  id: z.string(),
  type: z.enum(["agent", "input", "output"]),
  position: z.object({ x: z.number(), y: z.number() }),
  data: WorkflowNodeDataSchema,
});

// Edge definition (matches ReactFlow Edge structure)
export const WorkflowEdgeDefSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
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
