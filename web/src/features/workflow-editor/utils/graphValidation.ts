import type { Node, Edge } from "@xyflow/react";

/**
 * Detects if adding a new edge would create a cycle in the graph
 * Uses depth-first search (DFS) from the target to see if we can reach the source
 */
export function wouldCreateCycle(
  nodes: Node[],
  edges: Edge[],
  newEdge: { source: string; target: string },
): boolean {
  // Self-loop check
  if (newEdge.source === newEdge.target) {
    return true;
  }

  // Build adjacency list including the new edge
  const adjacency = new Map<string, string[]>();

  // Initialize all nodes
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }

  // Add existing edges
  for (const edge of edges) {
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

    // If we reached the source, we have a cycle
    if (current === newEdge.source) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    // Add all neighbors to the stack
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
 * Performs topological sort on the graph
 * Returns layers of node IDs that can be executed in parallel
 * Throws an error if the graph contains a cycle
 */
export function topologicalSort(nodes: Node[], edges: Edge[]): string[][] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Build graph
  for (const edge of edges) {
    const neighbors = adjacency.get(edge.source) ?? [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Find nodes with no incoming edges (sources)
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

  // Check if all nodes were processed (no cycles)
  const processedCount = layers.reduce((sum, layer) => sum + layer.length, 0);

  if (processedCount !== nodes.length) {
    throw new Error("Workflow contains a cycle");
  }

  return layers;
}
