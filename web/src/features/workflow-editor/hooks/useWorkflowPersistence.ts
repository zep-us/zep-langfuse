import { useCallback, useEffect } from "react";
import { api } from "@/src/utils/api";
import type { WorkflowNode, WorkflowEdge } from "../types";
import type { UIModelParams } from "@langfuse/shared";

interface UseWorkflowPersistenceProps {
  projectId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onLoad?: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
}

const DRAFT_STORAGE_KEY = (projectId: string) =>
  `langfuse-workflow-draft-${projectId}`;

// Helper to convert UIModelParams to plain ModelParams for server
function convertUIModelParamsToModelParams(uiParams: UIModelParams) {
  return {
    provider:
      typeof uiParams.provider === "object" && "value" in uiParams.provider
        ? uiParams.provider.value
        : uiParams.provider,
    model:
      typeof uiParams.model === "object" && "value" in uiParams.model
        ? uiParams.model.value
        : uiParams.model,
    adapter:
      typeof uiParams.adapter === "object" && "value" in uiParams.adapter
        ? uiParams.adapter.value
        : uiParams.adapter,
    temperature: uiParams.temperature?.enabled
      ? uiParams.temperature.value
      : undefined,
    max_tokens: uiParams.max_tokens?.enabled
      ? uiParams.max_tokens.value
      : undefined,
    top_p: uiParams.top_p?.enabled ? uiParams.top_p.value : undefined,
  };
}

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
      const convertedNodes = nodes.map((node) => {
        if (node.type === "agent" && node.data.modelParams) {
          return {
            ...node,
            data: {
              ...node.data,
              modelParams: convertUIModelParamsToModelParams(
                node.data.modelParams as UIModelParams,
              ),
            },
          };
        }
        return node;
      });

      await saveWorkflow.mutateAsync({
        projectId,
        name,
        description,
        tags,
        definition: {
          nodes: convertedNodes as any,
          edges: edges as any,
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
        const definition = workflow.definition as any;
        onLoad(
          definition.nodes as WorkflowNode[],
          definition.edges as WorkflowEdge[],
        );
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
