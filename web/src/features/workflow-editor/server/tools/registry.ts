/**
 * Tool Registry
 *
 * Central registry for workflow tool nodes. Tools register themselves here
 * and are looked up by type when a tool node is executed.
 */

import type { ToolDefinition } from "./types";

const toolRegistry = new Map<string, ToolDefinition>();

/**
 * Register a tool definition. Called at module load time by each tool.
 */
export function registerTool(tool: ToolDefinition): void {
  if (toolRegistry.has(tool.type)) {
    throw new Error(`Tool '${tool.type}' is already registered`);
  }
  toolRegistry.set(tool.type, tool);
}

/**
 * Get a tool definition by type.
 */
export function getTool(type: string): ToolDefinition | undefined {
  return toolRegistry.get(type);
}

/**
 * Get all registered tool definitions (for UI dropdowns).
 */
export function getAllTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

/**
 * Get tool types list (for validation).
 */
export function getRegisteredToolTypes(): string[] {
  return Array.from(toolRegistry.keys());
}
