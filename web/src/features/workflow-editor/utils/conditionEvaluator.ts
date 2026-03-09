/**
 * Condition evaluator for workflow router nodes.
 *
 * Evaluates EdgeCondition / EdgeConditionExpr against node outputs
 * to determine which branch a router should take.
 */

import type {
  EdgeCondition,
  EdgeConditionGroup,
  EdgeConditionExpr,
  WorkflowEdge,
  WorkflowEdgeData,
} from "../types";

/**
 * Extracts a value from a JSON string (or plain string) using a dot-separated field path.
 * Returns undefined if extraction fails.
 */
export function extractFieldValue(output: string, fieldPath: string): unknown {
  const parts = fieldPath.split(".");

  // Try JSON parse first
  let current: unknown;
  try {
    current = JSON.parse(output);
  } catch {
    // If not JSON, treat the whole string as "output"
    if (parts.length === 1 && parts[0] === "output") {
      return output;
    }
    // For "output.something", wrap in an object
    current = { output };
  }

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Evaluates a single condition against a node output string.
 * Returns true if the condition matches, false otherwise.
 * Never throws -- returns false on any evaluation error.
 */
export function evaluateCondition(
  condition: EdgeCondition,
  nodeOutput: string,
): boolean {
  try {
    const fieldValue = extractFieldValue(nodeOutput, condition.field);
    const strValue =
      fieldValue !== null && fieldValue !== undefined ? String(fieldValue) : "";

    switch (condition.operator) {
      case "equals":
        return strValue === (condition.value ?? "");

      case "not_equals":
        return strValue !== (condition.value ?? "");

      case "contains":
        return strValue.includes(condition.value ?? "");

      case "not_contains":
        return !strValue.includes(condition.value ?? "");

      case "regex_match": {
        if (!condition.value || condition.value.length > 200) {
          return false; // ReDoS protection: reject patterns > 200 chars
        }
        try {
          const regex = new RegExp(condition.value);
          return regex.test(strValue);
        } catch {
          return false; // Invalid regex pattern
        }
      }

      case "greater_than":
        return Number(fieldValue) > Number(condition.value);

      case "less_than":
        return Number(fieldValue) < Number(condition.value);

      case "is_empty":
        return (
          fieldValue === null || fieldValue === undefined || strValue === ""
        );

      case "is_not_empty":
        return (
          fieldValue !== null && fieldValue !== undefined && strValue !== ""
        );

      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Evaluates a compound condition expression (single or group) against node output.
 * Supports nested AND/OR logic (GAP-1).
 */
export function evaluateConditionExpr(
  expr: EdgeConditionExpr,
  nodeOutput: string,
): boolean {
  // Single condition: has 'field' and 'operator'
  if ("field" in expr && "operator" in expr) {
    return evaluateCondition(expr as EdgeCondition, nodeOutput);
  }
  // Compound group: has 'logic' and 'conditions'
  const group = expr as EdgeConditionGroup;
  if (group.logic === "and") {
    return group.conditions.every((c) => evaluateConditionExpr(c, nodeOutput));
  } else {
    // "or"
    return group.conditions.some((c) => evaluateConditionExpr(c, nodeOutput));
  }
}

/**
 * Helper to get edge data safely (backward compat with edges that have no data).
 */
function getEdgeData(edge: WorkflowEdge): WorkflowEdgeData | undefined {
  return edge.data as WorkflowEdgeData | undefined;
}

/**
 * Selects the active outgoing edge from a router node.
 * Evaluates conditions in edge order, returns first match.
 * Falls back to the default edge if no condition matches.
 */
export function selectActiveEdge(
  outgoingEdges: WorkflowEdge[],
  routerOutput: string,
): { activeEdge: WorkflowEdge; inactiveEdges: WorkflowEdge[] } {
  // Separate conditional, loop, and default edges
  const conditionalEdges: WorkflowEdge[] = [];
  const loopEdges: WorkflowEdge[] = [];
  let defaultEdge: WorkflowEdge | undefined;

  for (const edge of outgoingEdges) {
    const data = getEdgeData(edge);
    if (data?.edgeType === "conditional") {
      conditionalEdges.push(edge);
    } else if (data?.edgeType === "loop") {
      loopEdges.push(edge);
    } else {
      // "default" or no data
      defaultEdge = edge;
    }
  }

  // Evaluate conditional edges in order, return first match
  for (const edge of conditionalEdges) {
    const data = getEdgeData(edge);
    if (
      data?.condition &&
      evaluateConditionExpr(data.condition, routerOutput)
    ) {
      const inactiveEdges = outgoingEdges.filter((e) => e.id !== edge.id);
      return { activeEdge: edge, inactiveEdges };
    }
  }

  // Evaluate loop edges (they also have conditions)
  for (const edge of loopEdges) {
    const data = getEdgeData(edge);
    if (
      data?.condition &&
      evaluateConditionExpr(data.condition, routerOutput)
    ) {
      const inactiveEdges = outgoingEdges.filter((e) => e.id !== edge.id);
      return { activeEdge: edge, inactiveEdges };
    }
  }

  // Fall back to default edge
  if (defaultEdge) {
    const inactiveEdges = outgoingEdges.filter((e) => e.id !== defaultEdge!.id);
    return { activeEdge: defaultEdge, inactiveEdges };
  }

  // No default edge -- shouldn't happen if validation is correct
  throw new Error("Router has no default/fallback edge");
}
