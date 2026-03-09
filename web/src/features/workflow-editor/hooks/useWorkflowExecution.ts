import { useCallback } from "react";
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowEdgeData,
  AgentNodeData,
  InputNodeData,
  RouterNodeData,
  FieldMapping,
} from "../types";
import {
  classifyEdges,
  computeLoopBody,
  computeLoopOnlySources,
} from "../utils/graphValidation";
import {
  selectActiveEdge,
  evaluateConditionExpr,
} from "../utils/conditionEvaluator";
import { useWorkflowExecutionContext } from "../context/WorkflowExecutionContext";
import { api } from "@/src/utils/api";
import type { UIModelParams } from "@langfuse/shared";
import { convertUIModelParamsToModelParams } from "../utils/modelParams";

type NodeStatus = "pending" | "running" | "completed" | "error" | "skipped";

/**
 * Hook for executing a workflow DAG with router, conditional branching, and loop support.
 *
 * Uses a ready-queue-based engine with activation accounting instead of
 * topological-sort layers. This supports conditional branches (router nodes),
 * fan-in after divergent branches, per-branch error isolation, and loops.
 */
export function useWorkflowExecution(projectId: string) {
  const {
    setNodeState,
    addLogEntry,
    isExecuting,
    setIsExecuting,
    setWorkflowResults,
    workflowId,
  } = useWorkflowExecutionContext();
  const executeNodeMutation = api.workflows.execute.useMutation();
  const saveExecutionMutation =
    api.workflows.saveExecutionResults.useMutation();

  /**
   * Resolves variables in messages using mustache-style {{variable}} templates
   */
  const resolveVariables = useCallback(
    (
      text: string,
      variables: Record<string, string>,
      nodeOutputs: Map<string, string>,
    ): string => {
      let resolved = text;

      const variablePattern = /\{\{([^}]+)\}\}/g;
      resolved = resolved.replace(variablePattern, (match, varName) => {
        const trimmedVar = varName.trim();

        if (variables[trimmedVar]) {
          return variables[trimmedVar];
        }

        const parts = trimmedVar.split(".");
        if (parts.length >= 2) {
          const nodeId = parts[0];
          const output = nodeOutputs.get(nodeId);

          if (output) {
            if (parts.length === 2 && parts[1] === "output") {
              return output;
            }

            try {
              const parsed = JSON.parse(output);
              let value = parsed;
              for (let i = 1; i < parts.length; i++) {
                value = value[parts[i]];
              }
              return typeof value === "string" ? value : JSON.stringify(value);
            } catch {
              return output;
            }
          }
        }

        return match;
      });

      return resolved;
    },
    [],
  );

  /**
   * Applies input mappings to create variables from upstream node outputs
   */
  const applyInputMappings = useCallback(
    (
      mappings: FieldMapping[],
      nodeOutputs: Map<string, string>,
      globalVariables: Record<string, string>,
    ): Record<string, string> => {
      const variables = { ...globalVariables };

      for (const mapping of mappings) {
        const parts = mapping.sourceField.split(".");
        const sourceNodeId = parts[0];
        const sourceOutput = nodeOutputs.get(sourceNodeId);

        if (!sourceOutput) continue;

        if (mapping.mappingType === "full") {
          variables[mapping.targetVariable] = sourceOutput;
        } else {
          try {
            const parsed = JSON.parse(sourceOutput);
            let value = parsed;
            for (let i = 1; i < parts.length; i++) {
              value = value[parts[i]];
            }
            variables[mapping.targetVariable] =
              typeof value === "string" ? value : JSON.stringify(value);
          } catch {
            variables[mapping.targetVariable] = sourceOutput;
          }
        }
      }

      return variables;
    },
    [],
  );

  /**
   * Executes a single agent node with retry logic
   */
  const executeAgentNode = useCallback(
    async (
      nodeId: string,
      node: WorkflowNode,
      variables: Record<string, string>,
      nodeOutputs: Map<string, string>,
      workflowContext: Map<string, unknown>,
    ): Promise<string> => {
      const agentData = node.data as AgentNodeData;
      const executionMode = agentData.executionMode ?? "llm";

      // Inject context reads into variables
      if (agentData.contextReads) {
        for (const key of agentData.contextReads) {
          const val = workflowContext.get(key);
          if (val !== undefined) {
            variables[key] =
              typeof val === "string" ? val : JSON.stringify(val);
          }
        }
      }

      // Passthrough mode: just return resolved variables as JSON
      if (executionMode === "passthrough") {
        return JSON.stringify(variables);
      }

      // Tool mode: placeholder -- pass through for now
      if (executionMode === "tool") {
        return JSON.stringify(variables);
      }

      // LLM mode (default)
      const maxRetries = agentData.retryConfig?.maxRetries ?? 0;
      const retryDelay = agentData.retryConfig?.retryDelay ?? 1000;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const resolvedMessages = agentData.messages?.map((msg) => ({
            ...msg,
            content:
              typeof msg.content === "string"
                ? resolveVariables(msg.content, variables, nodeOutputs)
                : msg.content,
          }));

          const modelParams = convertUIModelParamsToModelParams(
            agentData.modelParams as UIModelParams,
          );

          const result = await executeNodeMutation.mutateAsync({
            projectId,
            messages: resolvedMessages ?? [],
            modelParams,
            tools: agentData.tools?.length ? agentData.tools : undefined,
            structuredOutputSchema: agentData.structuredOutputSchema?.schema,
          });

          const output =
            typeof result === "string"
              ? result
              : "content" in result
                ? typeof result.content === "string"
                  ? result.content
                  : JSON.stringify(result.content)
                : JSON.stringify(result);

          return output;
        } catch (error) {
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            addLogEntry({
              nodeId,
              timestamp: Date.now(),
              type: "error",
              message: `Attempt ${attempt + 1} failed, retrying...`,
            });
            continue;
          }
          throw error;
        }
      }

      throw new Error("Unreachable");
    },
    [projectId, resolveVariables, addLogEntry, executeNodeMutation],
  );

  /**
   * Main workflow execution function.
   * Uses ready-queue engine with activation accounting.
   */
  const execute = useCallback(
    async (
      nodes: WorkflowNode[],
      edges: WorkflowEdge[],
      inputVariables: Record<string, string> = {},
    ) => {
      if (isExecuting) {
        throw new Error("Workflow is already executing");
      }

      setIsExecuting(true);

      try {
        // --- 1. Classify edges ---
        const { forwardEdges, loopEdges } = classifyEdges(nodes, edges);

        // --- 1b. Compute loop-only-reachable nodes (GAP-2) ---
        const loopOnlySources = computeLoopOnlySources(nodes, forwardEdges);

        // --- 1c. Initialize shared workflow context (GAP-3) ---
        const workflowContext = new Map<string, unknown>();

        // --- 2. Build execution state ---
        const nodeOutputs = new Map<string, string>();
        const nodeStatuses = new Map<string, NodeStatus>();

        // Activation accounting per node
        const totalIncoming = new Map<string, number>();
        const resolvedCount = new Map<string, number>();
        const skippedCount = new Map<string, number>();
        const erroredCount = new Map<string, number>();

        // Loop iteration tracking
        const iterationCounts = new Map<string, number>();

        // Build forward adjacency and compute incoming edge counts
        const forwardOutgoing = new Map<string, WorkflowEdge[]>();
        const loopOutgoing = new Map<string, WorkflowEdge[]>();
        // Cast classified edges to WorkflowEdge (they come from the input edges array)
        const typedForwardEdges = forwardEdges as WorkflowEdge[];
        const typedLoopEdges = loopEdges as WorkflowEdge[];

        for (const node of nodes) {
          forwardOutgoing.set(node.id, []);
          loopOutgoing.set(node.id, []);
          nodeStatuses.set(node.id, "pending");
          resolvedCount.set(node.id, 0);
          skippedCount.set(node.id, 0);
          erroredCount.set(node.id, 0);
        }

        // Count forward incoming edges, excluding edges from loop-only sources
        for (const node of nodes) {
          let count = 0;
          for (const edge of typedForwardEdges) {
            if (edge.target === node.id && !loopOnlySources.has(edge.source)) {
              count++;
            }
          }
          totalIncoming.set(node.id, count);
        }

        for (const edge of typedForwardEdges) {
          const list = forwardOutgoing.get(edge.source) ?? [];
          list.push(edge);
          forwardOutgoing.set(edge.source, list);
        }

        for (const edge of typedLoopEdges) {
          const list = loopOutgoing.get(edge.source) ?? [];
          list.push(edge);
          loopOutgoing.set(edge.source, list);
        }

        // Extract input variables from Input node
        const inputNode = nodes.find((n) => n.type === "input");
        const extractedVariables: Record<string, string> = {};
        if (inputNode) {
          const inputData = inputNode.data as InputNodeData;
          if (
            inputData.inputVariables &&
            Array.isArray(inputData.inputVariables)
          ) {
            for (const { name, value } of inputData.inputVariables) {
              extractedVariables[name] = value;
            }
          }
        }
        const globalVariables = { ...extractedVariables, ...inputVariables };

        // Seed workflow context from global variables
        for (const [key, value] of Object.entries(globalVariables)) {
          workflowContext.set(key, value);
        }

        // --- 3. Seed ready queue with entry nodes ---
        const readyQueue: string[] = [];
        for (const node of nodes) {
          if ((totalIncoming.get(node.id) ?? 0) === 0) {
            readyQueue.push(node.id);
          }
        }

        // --- 4. Main execution loop ---
        while (readyQueue.length > 0) {
          // Dequeue all ready nodes for parallel execution
          const batch = readyQueue.splice(0, readyQueue.length);

          await Promise.all(
            batch.map(async (nodeId) => {
              const node = nodes.find((n) => n.id === nodeId);
              if (!node) return;

              // Set running state
              nodeStatuses.set(nodeId, "running");
              setNodeState(nodeId, {
                status: "running",
                retryCount: 0,
                startTime: Date.now(),
              });
              addLogEntry({
                nodeId,
                timestamp: Date.now(),
                type: "start",
                message: `Starting ${node.data.label}`,
              });

              try {
                // --- Execute based on node type ---
                if (node.type === "input") {
                  const output = JSON.stringify(globalVariables);
                  nodeOutputs.set(nodeId, output);
                  nodeStatuses.set(nodeId, "completed");
                  setNodeState(nodeId, {
                    status: "completed",
                    output,
                    retryCount: 0,
                    endTime: Date.now(),
                    startTime: Date.now(),
                  });
                  return;
                }

                if (node.type === "output") {
                  const parentEdges = typedForwardEdges.filter(
                    (e) => e.target === nodeId,
                  );
                  const results = parentEdges
                    .filter((e) => nodeStatuses.get(e.source) === "completed")
                    .map((e) => ({
                      nodeId: e.source,
                      output: nodeOutputs.get(e.source) ?? "",
                    }));
                  const output = JSON.stringify(results);
                  nodeOutputs.set(nodeId, output);
                  nodeStatuses.set(nodeId, "completed");
                  setNodeState(nodeId, {
                    status: "completed",
                    output,
                    retryCount: 0,
                    endTime: Date.now(),
                    startTime: Date.now(),
                  });
                  return;
                }

                if (node.type === "router") {
                  // Router: passthrough upstream output, evaluate conditions in propagation
                  const routerData = node.data as RouterNodeData;
                  const incomingEdge = typedForwardEdges.find(
                    (e) =>
                      e.target === nodeId &&
                      nodeStatuses.get(e.source) === "completed",
                  );
                  const upstreamOutput = incomingEdge
                    ? (nodeOutputs.get(incomingEdge.source) ?? "")
                    : "";

                  nodeOutputs.set(nodeId, upstreamOutput);
                  nodeStatuses.set(nodeId, "completed");
                  setNodeState(nodeId, {
                    status: "completed",
                    output: upstreamOutput,
                    retryCount: 0,
                    endTime: Date.now(),
                    startTime: Date.now(),
                  });
                  addLogEntry({
                    nodeId,
                    timestamp: Date.now(),
                    type: "complete",
                    message: `Router '${routerData.label}' evaluated, routing based on '${routerData.routeField}'`,
                  });
                  return;
                }

                if (node.type === "agent") {
                  const agentData = node.data as AgentNodeData;
                  const variables = applyInputMappings(
                    agentData.inputMapping ?? [],
                    nodeOutputs,
                    globalVariables,
                  );

                  const output = await executeAgentNode(
                    nodeId,
                    node,
                    variables,
                    nodeOutputs,
                    workflowContext,
                  );

                  nodeOutputs.set(nodeId, output);
                  nodeStatuses.set(nodeId, "completed");

                  // Write context outputs (GAP-3)
                  if (agentData.contextWrites) {
                    try {
                      const parsed = JSON.parse(output);
                      for (const key of agentData.contextWrites) {
                        if (parsed[key] !== undefined) {
                          workflowContext.set(key, parsed[key]);
                        }
                      }
                    } catch {
                      // Non-JSON output, skip context writes
                    }
                  }

                  setNodeState(nodeId, {
                    status: "completed",
                    output,
                    retryCount: 0,
                    endTime: Date.now(),
                    startTime: Date.now(),
                  });
                  addLogEntry({
                    nodeId,
                    timestamp: Date.now(),
                    type: "complete",
                    message: `Completed ${agentData.label}`,
                    data: { outputLength: output.length },
                  });
                  return;
                }
              } catch (error) {
                let errorMessage = "Unknown error";
                if (error instanceof Error) {
                  errorMessage = error.message;
                  // Check for tRPC error with nested message
                  const trpcError = error as unknown as Record<string, unknown>;
                  const trpcData = trpcError?.data as
                    | Record<string, unknown>
                    | undefined;
                  if (
                    trpcData?.message &&
                    typeof trpcData.message === "string"
                  ) {
                    errorMessage = trpcData.message;
                  }
                }

                nodeStatuses.set(nodeId, "error");
                setNodeState(nodeId, {
                  status: "error",
                  error: errorMessage,
                  retryCount: 0,
                  endTime: Date.now(),
                  startTime: Date.now(),
                });
                addLogEntry({
                  nodeId,
                  timestamp: Date.now(),
                  type: "error",
                  message: errorMessage,
                });
                // Per-branch error isolation: don't throw, propagate via accounting
              }
            }),
          );

          // --- 4b. Propagate results and enqueue newly ready nodes ---
          for (const nodeId of batch) {
            const status = nodeStatuses.get(nodeId);
            const node = nodes.find((n) => n.id === nodeId);
            if (!node) continue;

            // Determine outgoing forward edges and their propagation type
            const outgoing = forwardOutgoing.get(nodeId) ?? [];
            let takenEdges: Set<string>;
            let notTakenEdges: Set<string>;

            if (node.type === "router" && status === "completed") {
              // Router: evaluate conditions to select active edge
              const routerOutput = nodeOutputs.get(nodeId) ?? "";
              try {
                const { activeEdge, inactiveEdges } = selectActiveEdge(
                  outgoing,
                  routerOutput,
                );
                takenEdges = new Set([activeEdge.id]);
                notTakenEdges = new Set(inactiveEdges.map((e) => e.id));

                const activeData = activeEdge.data as
                  | WorkflowEdgeData
                  | undefined;
                addLogEntry({
                  nodeId,
                  timestamp: Date.now(),
                  type: "output",
                  message: `Router selected edge '${activeEdge.id}' (${activeData?.conditionLabel ?? activeData?.edgeType ?? "default"})`,
                });

                // Check if active edge is a loop edge (from loopOutgoing)
                // Loop edges are not in forwardOutgoing, check separately
              } catch (routerError) {
                // No valid edge -- treat all as not taken
                takenEdges = new Set();
                notTakenEdges = new Set(outgoing.map((e) => e.id));
                addLogEntry({
                  nodeId,
                  timestamp: Date.now(),
                  type: "error",
                  message: `Router edge selection failed: ${routerError instanceof Error ? routerError.message : "unknown error"}`,
                });
              }

              // Handle loop edges from this router
              const routerLoopEdges = loopOutgoing.get(nodeId) ?? [];
              if (routerLoopEdges.length > 0) {
                const routerOutput2 = nodeOutputs.get(nodeId) ?? "";
                for (const loopEdge of routerLoopEdges) {
                  const loopData = loopEdge.data as
                    | WorkflowEdgeData
                    | undefined;
                  // Only fire loop if it was the "active" choice
                  // Check: if no forward edge was taken by condition, evaluate loop edges
                  // Loop edges are mutually exclusive with forward edges.
                  // Only evaluate loop when no forward conditional edge was taken.
                  if (takenEdges.size > 0) continue;
                  const shouldEvalLoop = loopData?.condition
                    ? evaluateConditionExpr(loopData.condition, routerOutput2)
                    : true; // Loop without condition fires when no forward edge matched

                  if (!shouldEvalLoop) continue;

                  const iterationKey = `${nodeId}->${loopEdge.target}`;
                  const currentIteration =
                    iterationCounts.get(iterationKey) ?? 0;
                  const maxIterations = loopData?.maxIterations ?? 10;

                  if (currentIteration >= maxIterations) {
                    addLogEntry({
                      nodeId,
                      timestamp: Date.now(),
                      type: "output",
                      message: `Loop max iterations (${maxIterations}) reached, exiting loop`,
                    });
                    continue;
                  }

                  iterationCounts.set(iterationKey, currentIteration + 1);
                  addLogEntry({
                    nodeId,
                    timestamp: Date.now(),
                    type: "output",
                    message: `Loop iteration ${currentIteration + 1}/${maxIterations}`,
                  });

                  // Compute and reset loop body
                  const loopBodyNodes = computeLoopBody(
                    nodes,
                    typedForwardEdges,
                    loopEdge,
                  );

                  for (const bodyNodeId of loopBodyNodes) {
                    nodeOutputs.delete(bodyNodeId);
                    nodeStatuses.set(bodyNodeId, "pending");
                    setNodeState(bodyNodeId, {
                      status: "pending",
                      retryCount: 0,
                    });
                    resolvedCount.set(bodyNodeId, 0);
                    skippedCount.set(bodyNodeId, 0);
                    erroredCount.set(bodyNodeId, 0);
                  }

                  // Recompute totalIncoming for loop body (internal forward edges only)
                  for (const bodyNodeId of loopBodyNodes) {
                    const internalCount = typedForwardEdges.filter(
                      (e) =>
                        e.target === bodyNodeId && loopBodyNodes.has(e.source),
                    ).length;
                    totalIncoming.set(bodyNodeId, internalCount);
                  }

                  // The loop target has its internal edges reset; seed it
                  readyQueue.push(loopEdge.target);
                }
              }
            } else if (status === "completed") {
              // Non-router completed: all forward edges are taken
              takenEdges = new Set(outgoing.map((e) => e.id));
              notTakenEdges = new Set();
            } else if (status === "skipped") {
              // Skipped: propagate skip to all
              takenEdges = new Set();
              notTakenEdges = new Set(outgoing.map((e) => e.id));
            } else if (status === "error") {
              // Error: propagate error downstream
              takenEdges = new Set();
              notTakenEdges = new Set(outgoing.map((e) => e.id));
            } else {
              continue; // still pending/running
            }

            // Update activation accounting for downstream nodes
            for (const edge of outgoing) {
              const targetId = edge.target;
              // Skip if target is already resolved
              if (
                nodeStatuses.get(targetId) === "completed" ||
                nodeStatuses.get(targetId) === "skipped" ||
                nodeStatuses.get(targetId) === "error"
              ) {
                continue;
              }

              resolvedCount.set(
                targetId,
                (resolvedCount.get(targetId) ?? 0) + 1,
              );

              if (status === "skipped" || notTakenEdges.has(edge.id)) {
                skippedCount.set(
                  targetId,
                  (skippedCount.get(targetId) ?? 0) + 1,
                );
              } else if (status === "error") {
                erroredCount.set(
                  targetId,
                  (erroredCount.get(targetId) ?? 0) + 1,
                );
              }

              // Check if target is now fully resolved
              const targetTotal = totalIncoming.get(targetId) ?? 0;
              const targetResolved = resolvedCount.get(targetId) ?? 0;

              if (targetResolved >= targetTotal && targetTotal > 0) {
                const targetSkipped = skippedCount.get(targetId) ?? 0;
                const targetErrored = erroredCount.get(targetId) ?? 0;

                if (targetSkipped === targetTotal) {
                  // All sources skipped -> skip this node
                  nodeStatuses.set(targetId, "skipped");
                  setNodeState(targetId, {
                    status: "skipped",
                    retryCount: 0,
                  });
                  addLogEntry({
                    nodeId: targetId,
                    timestamp: Date.now(),
                    type: "complete",
                    message: "Skipped (all incoming branches skipped)",
                  });
                  // Intentional: pushing to `batch` during for...of iteration extends
                  // the iteration, enabling cascading skip/error propagation in one pass.
                  batch.push(targetId);
                } else if (targetErrored + targetSkipped === targetTotal) {
                  // All sources errored or skipped -> error
                  nodeStatuses.set(targetId, "error");
                  setNodeState(targetId, {
                    status: "error",
                    error: "All incoming branches errored or were skipped",
                    retryCount: 0,
                  });
                  batch.push(targetId);
                } else {
                  // At least one completed source -> ready to execute
                  readyQueue.push(targetId);
                }
              }
            }
          }
        }

        // --- 5. Mark any remaining unresolved nodes as skipped ---
        for (const node of nodes) {
          if (nodeStatuses.get(node.id) === "pending") {
            nodeStatuses.set(node.id, "skipped");
            setNodeState(node.id, { status: "skipped", retryCount: 0 });
          }
        }

        // --- 6. Determine final status ---
        let hasError = false;
        for (const status of nodeStatuses.values()) {
          if (status === "error") {
            hasError = true;
            break;
          }
        }

        addLogEntry({
          nodeId: "system",
          timestamp: Date.now(),
          type: "complete",
          message: hasError
            ? "Workflow completed with errors"
            : "Workflow completed successfully",
        });

        // Store final results from Output node
        const outputNode = nodes.find((n) => n.type === "output");
        if (outputNode) {
          const outputNodeState = nodeOutputs.get(outputNode.id);
          if (outputNodeState) {
            try {
              const parsedResults = JSON.parse(outputNodeState);
              setWorkflowResults(parsedResults);

              if (workflowId) {
                saveExecutionMutation.mutate(
                  {
                    projectId,
                    workflowId,
                    results: parsedResults,
                    status: hasError ? "error" : "success",
                    timestamp: Date.now(),
                  },
                  {
                    onError: (err) => {
                      console.error("Failed to save execution results:", err);
                    },
                  },
                );
              }
            } catch {
              const fallbackResults = [
                { nodeId: outputNode.id, output: outputNodeState },
              ];
              setWorkflowResults(fallbackResults);

              if (workflowId) {
                saveExecutionMutation.mutate(
                  {
                    projectId,
                    workflowId,
                    results: fallbackResults,
                    status: hasError ? "error" : "success",
                    timestamp: Date.now(),
                  },
                  {
                    onError: (err) => {
                      console.error("Failed to save execution results:", err);
                    },
                  },
                );
              }
            }
          }
        }
      } finally {
        setIsExecuting(false);
      }
    },
    [
      isExecuting,
      setIsExecuting,
      setNodeState,
      addLogEntry,
      applyInputMappings,
      executeAgentNode,
      setWorkflowResults,
      workflowId,
      saveExecutionMutation,
      projectId,
    ],
  );

  return {
    execute,
    isExecuting,
  };
}
