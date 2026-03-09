import type { Node, Edge } from "@xyflow/react";
import type { WorkflowEdgeData } from "../types";

/**
 * Gets the edge type from edge data, defaulting to "default" for backward compat.
 */
function getEdgeType(edge: Edge): string {
  const data = edge.data as WorkflowEdgeData | undefined;
  return data?.edgeType ?? "default";
}

/**
 * Detects if adding a new edge would create a cycle in the graph.
 * Uses depth-first search (DFS) from the target to see if we can reach the source.
 *
 * When `options.allowLoopEdges` is true, edges with edgeType === "loop" are
 * excluded from cycle detection (loops are expected cycles).
 */
export function wouldCreateCycle(
  nodes: Node[],
  edges: Edge[],
  newEdge: { source: string; target: string },
  options?: { allowLoopEdges?: boolean },
): boolean {
  // Self-loop check
  if (newEdge.source === newEdge.target) {
    return true;
  }

  // Filter edges: exclude loop edges when allowed
  const filteredEdges = options?.allowLoopEdges
    ? edges.filter((e) => getEdgeType(e) !== "loop")
    : edges;

  // Build adjacency list including the new edge
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
  }

  for (const edge of filteredEdges) {
    const neighbors = adjacency.get(edge.source) ?? [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
  }

  // Add the new edge
  const newEdgeNeighbors = adjacency.get(newEdge.source) ?? [];
  newEdgeNeighbors.push(newEdge.target);
  adjacency.set(newEdge.source, newEdgeNeighbors);

  // DFS from target to see if we can reach source
  const visited = new Set<string>();
  const stack = [newEdge.target];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (current === newEdge.source) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
      }
    }
  }

  return false;
}

/**
 * Performs topological sort on the graph.
 * Returns layers of node IDs that can be executed in parallel.
 * Throws an error if the graph contains a cycle.
 *
 * Only considers forward edges (excludes loop edges).
 */
export function topologicalSort(nodes: Node[], edges: Edge[]): string[][] {
  const { forwardEdges } = classifyEdges(nodes, edges);

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of forwardEdges) {
    const neighbors = adjacency.get(edge.source) ?? [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  let queue = nodes
    .filter((node) => (inDegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);

  const layers: string[][] = [];

  while (queue.length > 0) {
    layers.push([...queue]);
    const nextQueue: string[] = [];

    for (const nodeId of queue) {
      const neighbors = adjacency.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        const newInDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newInDegree);
        if (newInDegree === 0) {
          nextQueue.push(neighbor);
        }
      }
    }

    queue = nextQueue;
  }

  const processedCount = layers.reduce((sum, layer) => sum + layer.length, 0);

  if (processedCount !== nodes.length) {
    throw new Error("Workflow contains a cycle");
  }

  return layers;
}

/**
 * Classifies edges into forward edges and loop edges.
 */
export function classifyEdges(
  _nodes: Node[],
  edges: Edge[],
): { forwardEdges: Edge[]; loopEdges: Edge[] } {
  const forwardEdges: Edge[] = [];
  const loopEdges: Edge[] = [];

  for (const edge of edges) {
    if (getEdgeType(edge) === "loop") {
      loopEdges.push(edge);
    } else {
      forwardEdges.push(edge);
    }
  }

  return { forwardEdges, loopEdges };
}

/**
 * Validates that no two router nodes are directly connected.
 * Returns violations (direct router-to-router edges).
 */
export function validateNoAdjacentRouters(
  nodes: Node[],
  edges: Edge[],
): {
  valid: boolean;
  violations: Array<{ sourceId: string; targetId: string }>;
} {
  const routerIds = new Set(
    nodes.filter((n) => n.type === "router").map((n) => n.id),
  );

  const violations: Array<{ sourceId: string; targetId: string }> = [];

  for (const edge of edges) {
    if (getEdgeType(edge) === "loop") continue; // loop edges exempt
    if (routerIds.has(edge.source) && routerIds.has(edge.target)) {
      violations.push({ sourceId: edge.source, targetId: edge.target });
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Computes the set of nodes in a loop body.
 * The loop body = all nodes on forward paths from loopEdge.target to loopEdge.source.
 */
export function computeLoopBody(
  _nodes: Node[],
  edges: Edge[],
  loopEdge: Edge,
): Set<string> {
  const startNode = loopEdge.target; // the node being looped back to
  const endNode = loopEdge.source; // the node that decides to loop

  // Build forward-only adjacency (exclude loop edges)
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (getEdgeType(edge) === "loop") continue;
    const neighbors = adjacency.get(edge.source) ?? [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
  }

  // BFS from startNode, collecting all nodes until endNode
  const loopBody = new Set<string>();
  const queue = [startNode];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (loopBody.has(current)) continue;
    loopBody.add(current);

    // Don't traverse past endNode (but include it)
    if (current === endNode) continue;

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!loopBody.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return loopBody;
}

/**
 * Computes nodes that are ONLY reachable via loop edges (GAP-2).
 * These nodes should be excluded from totalIncoming on the first pass.
 */
export function computeLoopOnlySources(
  nodes: Node[],
  forwardEdges: Edge[],
): Set<string> {
  // Build forward-only adjacency
  const forwardIncoming = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    forwardIncoming.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of forwardEdges) {
    const neighbors = adjacency.get(edge.source) ?? [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
    forwardIncoming.set(
      edge.target,
      (forwardIncoming.get(edge.target) ?? 0) + 1,
    );
  }

  // Entry nodes: 0 forward incoming edges
  const entryNodes = nodes
    .filter((n) => (forwardIncoming.get(n.id) ?? 0) === 0)
    .map((n) => n.id);

  // BFS from entry nodes via forward edges
  const reachable = new Set<string>();
  const queue = [...entryNodes];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!reachable.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  // Nodes NOT reachable via forward edges = loop-only-reachable
  const loopOnlySources = new Set<string>();
  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      loopOnlySources.add(node.id);
    }
  }

  return loopOnlySources;
}
