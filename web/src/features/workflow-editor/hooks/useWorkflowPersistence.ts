import { useCallback, useEffect } from "react";
import { api } from "@/src/utils/api";
import type { WorkflowNode, WorkflowEdge, WorkflowDefinition } from "../types";
import type { UIModelParams, ChatMessage } from "@langfuse/shared";
import { convertUIModelParamsToModelParams } from "../utils/modelParams";

interface UseWorkflowPersistenceProps {
  projectId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onLoad?: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
}

const DRAFT_STORAGE_KEY = (projectId: string) =>
  `langfuse-workflow-draft-${projectId}`;

export function useWorkflowPersistence({
  projectId,
  nodes,
  edges,
  onLoad,
}: UseWorkflowPersistenceProps) {
  const utils = api.useUtils();

  // Save workflow mutation
  const saveWorkflow = api.workflows.create.useMutation({
    onSuccess: async () => {
      // Invalidate workflows list to refresh
      await utils.workflows.getAll.invalidate();
      // Clear draft from sessionStorage
      sessionStorage.removeItem(DRAFT_STORAGE_KEY(projectId));
    },
  });

  // Get all workflows query
  const { data: workflows, isLoading: isLoadingWorkflows } =
    api.workflows.getAll.useQuery(
      { projectId },
      { enabled: Boolean(projectId) },
    );

  // Save workflow to database
  const save = useCallback(
    async (name: string, description: string = "", tags: string[] = []) => {
      if (!projectId) {
        throw new Error("Project ID is required");
      }

      // Convert UIModelParams to ModelParams for all agent nodes
      // Also strip out extra ReactFlow properties that aren't in the schema
      const convertedNodes = nodes.map((node) => {
        const baseNode = {
          id: node.id,
          type: node.type,
          position: node.position,
          data: node.data,
        };

        if (node.type === "agent" && node.data.modelParams) {
          return {
            ...baseNode,
            data: {
              ...baseNode.data,
              modelParams: convertUIModelParamsToModelParams(
                node.data.modelParams as UIModelParams,
              ),
            },
          };
        }
        return baseNode;
      });

      // Strip out extra ReactFlow properties from edges
      const convertedEdges = edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
        targetHandle: edge.targetHandle ?? undefined,
      }));

      // Type assertion needed: ReactFlow Node types have extra display properties
      // that are stripped above to match the simpler Zod schema. The schema validates
      // the structure at runtime.
      type SimplifiedNode = {
        id: string;
        type: "agent" | "input" | "output";
        position: { x: number; y: number };
        data: {
          label: string;
          promptId?: string;
          promptVersion?: number;
          messages?: ChatMessage[];
          modelParams?: {
            provider: string;
            model: string;
            adapter: string;
            temperature?: number;
            max_tokens?: number;
            top_p?: number;
            top_k?: number;
            max_completion_tokens?: number;
            maxReasoningTokens?: number;
            providerOptions?: Record<string, unknown>;
          };
          tools?: any[];
          structuredOutputSchema?: any;
          inputMapping?: {
            sourceField: string;
            targetVariable: string;
            mappingType: "field" | "full";
          }[];
          outputMapping?: {
            sourceField: string;
            targetVariable: string;
            mappingType: "field" | "full";
          }[];
          retryConfig?: { maxRetries?: number; retryDelay?: number };
        };
      };

      await saveWorkflow.mutateAsync({
        projectId,
        name,
        description,
        tags,
        definition: {
          nodes: convertedNodes as SimplifiedNode[],
          edges: convertedEdges,
        },
      });
    },
    [projectId, nodes, edges, saveWorkflow],
  );

  // Load workflow from database
  const load = useCallback(
    async (workflowId: string) => {
      if (!projectId) {
        throw new Error("Project ID is required");
      }

      const workflow = await utils.workflows.getById.fetch({
        projectId,
        id: workflowId,
      });

      if (workflow && workflow.definition && onLoad) {
        const definition = workflow.definition as unknown as WorkflowDefinition;
        onLoad(definition.nodes, definition.edges);
      }

      return workflow;
    },
    [projectId, utils, onLoad],
  );

  // Save draft to sessionStorage (auto-save)
  const saveDraft = useCallback(() => {
    try {
      sessionStorage.setItem(
        DRAFT_STORAGE_KEY(projectId),
        JSON.stringify({ nodes, edges, timestamp: Date.now() }),
      );
    } catch (error) {
      console.error("Failed to save draft:", error);
    }
  }, [projectId, nodes, edges]);

  // Load draft from sessionStorage
  const loadDraft = useCallback(() => {
    try {
      const draft = sessionStorage.getItem(DRAFT_STORAGE_KEY(projectId));
      if (draft) {
        const parsed = JSON.parse(draft);
        return {
          nodes: parsed.nodes as WorkflowNode[],
          edges: parsed.edges as WorkflowEdge[],
          timestamp: parsed.timestamp as number,
        };
      }
    } catch (error) {
      console.error("Failed to load draft:", error);
    }
    return null;
  }, [projectId]);

  // Clear draft
  const clearDraft = useCallback(() => {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY(projectId));
  }, [projectId]);

  // Auto-save draft every 30 seconds
  useEffect(() => {
    if (!projectId || nodes.length === 0) return;

    const interval = setInterval(() => {
      saveDraft();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [projectId, nodes, saveDraft]);

  // Save draft on unmount
  useEffect(() => {
    return () => {
      if (projectId && nodes.length > 0) {
        saveDraft();
      }
    };
  }, [projectId, nodes, saveDraft]);

  return {
    // Save operations
    save,
    isSaving: saveWorkflow.isPending,
    saveError: saveWorkflow.error,

    // Load operations
    load,
    workflows: workflows ?? [],
    isLoadingWorkflows,

    // Draft operations
    saveDraft,
    loadDraft,
    clearDraft,
  };
}
