import type { Node, Edge } from "@xyflow/react";
import type { ChatMessage, UIModelParams } from "@langfuse/shared";
import type {
  PlaygroundTool,
  PlaygroundSchema,
} from "@/src/features/playground/page/types";

// Field mapping for data flow between nodes
export interface FieldMapping {
  sourceField: string; // e.g., "node_1.output" or "node_1.output.topic"
  targetVariable: string; // e.g., "topic"
  mappingType: "full" | "field";
}

// Retry configuration for node execution
export interface RetryConfig {
  maxRetries: number;
  retryDelay: number; // milliseconds
}

// Input node specific data
export interface InputNodeData extends Record<string, unknown> {
  label: string;
  inputVariables?: Array<{ name: string; value: string }>;
}

// Agent node specific data
export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  // Prompt reference (from Langfuse Prompt Management)
  promptId?: string;
  promptVersion?: number;
  // Inline messages
  messages?: ChatMessage[];
  // Model configuration
  modelParams?: Partial<UIModelParams> &
    Pick<UIModelParams, "provider" | "model">;
  // Tools and structured output
  tools?: PlaygroundTool[];
  structuredOutputSchema?: PlaygroundSchema | null;
  // Data flow configuration
  inputMapping?: FieldMapping[];
  outputMapping?: FieldMapping[];
  // Error handling
  retryConfig?: RetryConfig;
}

// Output node specific data
export interface OutputNodeData extends Record<string, unknown> {
  label: string;
  inputMapping?: FieldMapping[];
}

// Node data stored in ReactFlow node (union of all node types)
export type WorkflowNodeData = InputNodeData | AgentNodeData | OutputNodeData;

// Node types supported in the workflow
export type WorkflowNodeType = "agent" | "input" | "output";

// ReactFlow node with workflow-specific data
export type WorkflowNode = Node<WorkflowNodeData, WorkflowNodeType>;

// ReactFlow edge
export type WorkflowEdge = Edge;

// Complete workflow definition (matches database JSON structure)
export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// Execution state for a single node
export interface NodeExecutionState {
  status: "pending" | "running" | "completed" | "error" | "skipped";
  output?: string;
  parsedOutput?: Record<string, unknown>;
  error?: string;
  startTime?: number;
  endTime?: number;
  retryCount: number;
}

// Execution log entry
export interface ExecutionLogEntry {
  nodeId: string;
  timestamp: number;
  type: "start" | "output" | "error" | "complete";
  message: string;
  data?: unknown;
}

// Workflow metadata from database
export interface WorkflowMetadata {
  id: string;
  projectId: string;
  name: string;
  description: string;
  version: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  definition: WorkflowDefinition;
  inputSchema?: unknown;
}

// Workflow execution result
export interface WorkflowResult {
  nodeId: string;
  output: string;
}

// Execution status
export type ExecutionStatus = "success" | "error" | "pending";

// Execution history entry
export interface ExecutionHistory {
  timestamp: number;
  results: WorkflowResult[];
  status: ExecutionStatus;
}
