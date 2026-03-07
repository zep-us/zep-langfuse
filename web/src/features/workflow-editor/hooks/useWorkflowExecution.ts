import { useCallback } from "react";
import type {
  WorkflowNode,
  WorkflowEdge,
  NodeExecutionState,
  FieldMapping,
  AgentNodeData,
  InputNodeData,
} from "../types";
import { topologicalSort } from "../utils/graphValidation";
import { useWorkflowExecutionContext } from "../context/WorkflowExecutionContext";
import { api } from "@/src/utils/api";
import type { UIModelParams } from "@langfuse/shared";
import { convertUIModelParamsToModelParams } from "../utils/modelParams";

/**
 * Hook for executing a workflow DAG
 */
export function useWorkflowExecution(projectId: string) {
  const {
    setNodeState,
    addLogEntry,
    isExecuting,
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

      // Replace {{variable}} patterns
      const variablePattern = /\{\{([^}]+)\}\}/g;
      resolved = resolved.replace(variablePattern, (match, varName) => {
        const trimmedVar = varName.trim();

        // Check if it's a direct variable
        if (variables[trimmedVar]) {
          return variables[trimmedVar];
        }

        // Check if it's a node output reference (e.g., node_1.output or node_1.output.field)
        const parts = trimmedVar.split(".");
        if (parts.length >= 2) {
          const nodeId = parts[0];
          const output = nodeOutputs.get(nodeId);

          if (output) {
            // If just {{nodeId.output}}, return full output
            if (parts.length === 2 && parts[1] === "output") {
              return output;
            }

            // Try to extract field from JSON output
            try {
              const parsed = JSON.parse(output);
              let value = parsed;
              for (let i = 1; i < parts.length; i++) {
                value = value[parts[i]];
              }
              return typeof value === "string" ? value : JSON.stringify(value);
            } catch {
              return output; // Return raw output if not JSON
            }
          }
        }

        // Return original if not found
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
          // Full output passthrough
          variables[mapping.targetVariable] = sourceOutput;
        } else {
          // Field extraction
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
  const executeNode = useCallback(
    async (
      nodeId: string,
      node: WorkflowNode,
      variables: Record<string, string>,
      nodeOutputs: Map<string, string>,
    ): Promise<string> => {
      const agentData = node.data as AgentNodeData;
      const maxRetries = agentData.retryConfig?.maxRetries ?? 0;
      const retryDelay = agentData.retryConfig?.retryDelay ?? 1000;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Resolve variables in messages
          const resolvedMessages = agentData.messages?.map((msg) => ({
            ...msg,
            content:
              typeof msg.content === "string"
                ? resolveVariables(msg.content, variables, nodeOutputs)
                : msg.content,
          }));

          // Convert UIModelParams to plain ModelParams for server
          const modelParams = convertUIModelParamsToModelParams(
            agentData.modelParams as UIModelParams,
          );

          // Use tRPC mutation for authenticated execution
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
            // Wait before retry
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            addLogEntry({
              nodeId,
              timestamp: Date.now(),
              type: "error",
              message: `Attempt ${attempt + 1} failed, retrying...`,
            });
            continue;
          }
          // Max retries reached
          throw error;
        }
      }

      throw new Error("Unreachable");
    },
    [projectId, resolveVariables, addLogEntry, executeNodeMutation],
  );

  /**
   * Main workflow execution function
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

      // Get execution layers via topological sort
      let layers: string[][];
      try {
        layers = topologicalSort(nodes, edges);
      } catch (error) {
        throw new Error("Cannot execute workflow with cycles");
      }

      // Extract inputVariables from Input node
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

      // Storage for node outputs
      const nodeOutputs = new Map<string, string>();
      // Merge extracted variables with passed inputVariables (passed ones take precedence)
      const globalVariables = { ...extractedVariables, ...inputVariables };

      // Execute layers sequentially
      for (const layer of layers) {
        // Execute nodes in this layer in parallel
        await Promise.all(
          layer.map(async (nodeId) => {
            const node = nodes.find((n) => n.id === nodeId);
            if (!node) return;

            // Set node state to running
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
              // Handle input nodes
              if (node.type === "input") {
                const output = JSON.stringify(globalVariables);
                nodeOutputs.set(nodeId, output);
                setNodeState(nodeId, {
                  status: "completed",
                  output,
                  retryCount: 0,
                  endTime: Date.now(),
                  startTime: Date.now(),
                });
                return;
              }

              // Handle output nodes
              if (node.type === "output") {
                const parentEdges = edges.filter((e) => e.target === nodeId);
                const results = parentEdges.map((e) => ({
                  nodeId: e.source,
                  output: nodeOutputs.get(e.source) ?? "",
                }));
                const output = JSON.stringify(results);
                nodeOutputs.set(nodeId, output);
                setNodeState(nodeId, {
                  status: "completed",
                  output,
                  retryCount: 0,
                  endTime: Date.now(),
                  startTime: Date.now(),
                });
                return;
              }

              // Handle agent nodes
              if (node.type === "agent") {
                const agentData = node.data as AgentNodeData;
                // Apply input mappings
                const variables = applyInputMappings(
                  agentData.inputMapping ?? [],
                  nodeOutputs,
                  globalVariables,
                );

                // Execute the node
                const output = await executeNode(
                  nodeId,
                  node,
                  variables,
                  nodeOutputs,
                );

                nodeOutputs.set(nodeId, output);
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
              }
            } catch (error) {
              // Extract error message from tRPC errors or regular errors
              let errorMessage = "Unknown error";
              if (error instanceof Error) {
                errorMessage = error.message;
                // Check for tRPC error with nested message
                const trpcError = error as any;
                if (trpcError?.data?.message) {
                  errorMessage = trpcError.data.message;
                } else if (trpcError?.message) {
                  errorMessage = trpcError.message;
                }
              }

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

              // Stop execution on first error
              throw error;
            }
          }),
        );
      }

      addLogEntry({
        nodeId: "system",
        timestamp: Date.now(),
        type: "complete",
        message: "Workflow completed successfully",
      });

      // Store final results from Output node
      const outputNode = nodes.find((n) => n.type === "output");
      if (outputNode) {
        const outputNodeState = nodeOutputs.get(outputNode.id);
        if (outputNodeState) {
          try {
            const parsedResults = JSON.parse(outputNodeState);
            setWorkflowResults(parsedResults);

            // Save execution results if workflowId is available
            if (workflowId) {
              saveExecutionMutation.mutate(
                {
                  projectId,
                  workflowId,
                  results: parsedResults,
                  status: "success",
                  timestamp: Date.now(),
                },
                {
                  onError: (error) => {
                    console.error("Failed to save execution results:", error);
                    // Don't throw - this is a non-critical operation
                  },
                },
              );
            }
          } catch {
            // If parsing fails, store as single result
            const fallbackResults = [
              { nodeId: outputNode.id, output: outputNodeState },
            ];
            setWorkflowResults(fallbackResults);

            // Save execution results if workflowId is available
            if (workflowId) {
              saveExecutionMutation.mutate(
                {
                  projectId,
                  workflowId,
                  results: fallbackResults,
                  status: "success",
                  timestamp: Date.now(),
                },
                {
                  onError: (error) => {
                    console.error("Failed to save execution results:", error);
                    // Don't throw - this is a non-critical operation
                  },
                },
              );
            }
          }
        }
      }
    },
    [
      isExecuting,
      setNodeState,
      addLogEntry,
      applyInputMappings,
      executeNode,
      setWorkflowResults,
      workflowId,
      saveExecutionMutation,
    ],
  );

  return {
    execute,
    isExecuting,
  };
}
