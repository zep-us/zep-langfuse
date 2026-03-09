/**
 * Workflow Tool Node Types
 *
 * Defines the interface for tool nodes in the workflow editor.
 * Tool nodes execute server-side logic (e.g., database queries, API calls)
 * instead of LLM completions.
 */

/**
 * Context provided to tool executors at runtime.
 */
export interface ToolExecutionContext {
  projectId: string;
  /** Resolved input data from upstream nodes and workflow context */
  inputData: Record<string, unknown>;
}

/**
 * Result returned by a tool executor.
 */
export interface ToolExecutionResult {
  success: boolean;
  /** Structured output data passed to downstream nodes */
  output: Record<string, unknown>;
  /** Optional error message when success=false */
  error?: string;
}

/**
 * Configuration schema field for tool settings UI.
 */
export interface ToolConfigField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  description?: string;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>; // for type: "select"
  required?: boolean;
}

/**
 * Defines a tool that can be used in workflow tool nodes.
 */
export interface ToolDefinition {
  /** Unique tool type identifier (e.g., "neo4j-vector-search") */
  type: string;
  /** Human-readable name */
  label: string;
  /** Description of what the tool does */
  description: string;
  /** Configuration fields shown in the node config panel */
  configFields: ToolConfigField[];
  /** Execute the tool with the given config and context */
  execute: (
    config: Record<string, unknown>,
    context: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>;
}
