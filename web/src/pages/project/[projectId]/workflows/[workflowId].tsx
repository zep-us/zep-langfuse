import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/router";
import Header from "@/src/components/layouts/header";
import { WorkflowCanvas } from "@/src/features/workflow-editor/components/WorkflowCanvas";
import { Button } from "@/src/components/ui/button";
import {
  Plus,
  Play,
  Save,
  StopCircle,
  FolderOpen,
  FileInput,
  X,
  GitBranch,
} from "lucide-react";
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeData,
} from "@/src/features/workflow-editor/types";
import {
  WorkflowExecutionProvider,
  useWorkflowExecutionContext,
} from "@/src/features/workflow-editor/context/WorkflowExecutionContext";
import { useWorkflowExecution } from "@/src/features/workflow-editor/hooks/useWorkflowExecution";
import { useWorkflowPersistence } from "@/src/features/workflow-editor/hooks/useWorkflowPersistence";
import { WorkflowSaveDialog } from "@/src/features/workflow-editor/components/dialogs/WorkflowSaveDialog";
import { WorkflowLoadDialog } from "@/src/features/workflow-editor/components/dialogs/WorkflowLoadDialog";
import { NodeConfigPanel } from "@/src/features/workflow-editor/components/panels/NodeConfigPanel";
import { RunPanel } from "@/src/features/workflow-editor/components/panels/RunPanel";
import { PromptImportDialog } from "@/src/features/workflow-editor/components/dialogs/PromptImportDialog";
import { WorkflowOutputDialog } from "@/src/features/workflow-editor/components/dialogs/WorkflowOutputDialog";
import { ChatMessageType, ChatMessageRole, LLMAdapter } from "@langfuse/shared";
import type {
  PromptChatMessageSchema,
  UIModelParams,
  ChatMessage,
} from "@langfuse/shared";
import { z } from "zod/v4";
import { api } from "@/src/utils/api";
import { cn } from "@/src/utils/tailwind";

type PromptMessage = z.infer<typeof PromptChatMessageSchema>;

const DEFAULT_NODES: WorkflowNode[] = [
  {
    id: "input-1",
    type: "input",
    position: { x: 250, y: 50 },
    data: { label: "Workflow Input" },
  },
  {
    id: "agent-1",
    type: "agent",
    position: { x: 200, y: 200 },
    data: {
      label: "Agent 1",
      modelParams: {
        provider: { value: "openai", enabled: true },
        model: { value: "gpt-4", enabled: true },
        adapter: { value: LLMAdapter.OpenAI, enabled: true },
      },
      messages: [
        {
          type: ChatMessageType.User,
          role: ChatMessageRole.User,
          content: "Say hello to {{name}}",
        },
      ],
    },
  },
  {
    id: "output-1",
    type: "output",
    position: { x: 250, y: 400 },
    data: { label: "Workflow Output" },
  },
];

const DEFAULT_EDGES: WorkflowEdge[] = [
  { id: "e-input-agent", source: "input-1", target: "agent-1" },
  { id: "e-agent-output", source: "agent-1", target: "output-1" },
];

function WorkflowEditorContent() {
  const router = useRouter();
  const projectId = router.query.projectId as string;
  const workflowId = router.query.workflowId as string;
  const isNewWorkflow = workflowId === "new";

  const { workflowResults, showOutputDialog, setShowOutputDialog } =
    useWorkflowExecutionContext();

  const [nodes, setNodes] = useState<WorkflowNode[]>(DEFAULT_NODES);
  const [edges, setEdges] = useState<WorkflowEdge[]>(DEFAULT_EDGES);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(
    isNewWorkflow ? null : workflowId,
  );
  const [isLoading, setIsLoading] = useState(!isNewWorkflow);

  const { execute, isExecuting } = useWorkflowExecution(projectId);

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showPromptImport, setShowPromptImport] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "run" | null>(null);

  const utils = api.useUtils();

  const { save, isSaving, workflows, isLoadingWorkflows, load } =
    useWorkflowPersistence({
      projectId,
      nodes,
      edges,
      onLoad: (loadedNodes, loadedEdges) => {
        setNodes(loadedNodes);
        setEdges(loadedEdges);
      },
    });

  // Load workflow when workflowId changes (and it's not "new")
  useEffect(() => {
    if (!isNewWorkflow && workflowId && projectId) {
      setIsLoading(true);
      load(workflowId)
        .then(() => {
          setCurrentWorkflowId(workflowId);
        })
        .catch((error) => {
          console.error("Failed to load workflow:", error);
          // Redirect to workflows list on error
          void router.push(`/project/${projectId}/workflows`);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, isNewWorkflow, projectId]);

  const handleAddAgent = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `agent-${Date.now()}`,
      type: "agent",
      position: { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 },
      data: {
        label: `Agent ${nodes.filter((n) => n.type === "agent").length + 1}`,
        messages: [],
      },
    };
    setNodes((prev) => [...prev, newNode]);
  }, [nodes]);

  const handleRun = useCallback(async () => {
    try {
      // For MVP, use hardcoded input variables
      const inputVariables = {
        name: "Claude",
      };

      await execute(nodes, edges, inputVariables);
    } catch (error) {
      console.error("Workflow execution failed:", error);
    }
  }, [nodes, edges, execute]);

  const handleSave = useCallback(
    async (name: string, description: string) => {
      await save(name, description);
      // Invalidate and refetch to get the newly created workflow
      await utils.workflows.getAll.invalidate();

      // If this was a new workflow, redirect to the saved workflow's URL
      if (isNewWorkflow) {
        const updatedWorkflows = await utils.workflows.getAll.fetch({
          projectId,
        });
        // Find the most recently created workflow (should be the one we just saved)
        const newestWorkflow = updatedWorkflows.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )[0];
        if (newestWorkflow) {
          setCurrentWorkflowId(newestWorkflow.id);
          void router.push(
            `/project/${projectId}/workflows/${newestWorkflow.id}`,
          );
        }
      }
    },
    [save, isNewWorkflow, projectId, router, utils],
  );

  const handleLoad = useCallback(
    async (loadWorkflowId: string) => {
      await load(loadWorkflowId);
      setCurrentWorkflowId(loadWorkflowId);
      // Update URL to reflect the loaded workflow
      void router.push(`/project/${projectId}/workflows/${loadWorkflowId}`);
    },
    [load, projectId, router],
  );

  const handleNodeUpdate = useCallback(
    (nodeId: string, updates: Partial<WorkflowNodeData>) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, ...updates } }
            : node,
        ),
      );
    },
    [],
  );

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: WorkflowNode) => {
      setSelectedNodeId(node.id);
      setActiveTab("config");
    },
    [],
  );

  const handleCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
    if (activeTab === "config") setActiveTab(null);
  }, [activeTab]);

  const handlePromptImport = useCallback(
    (promptData: {
      messages: PromptMessage[];
      modelParams: Record<string, unknown>;
    }) => {
      if (selectedNodeId) {
        handleNodeUpdate(selectedNodeId, {
          messages: promptData.messages as ChatMessage[],
          modelParams: promptData.modelParams as Partial<UIModelParams> &
            Pick<UIModelParams, "provider" | "model">,
        });
        setShowPromptImport(false);
      }
    },
    [selectedNodeId, handleNodeUpdate],
  );

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col">
        <Header title="Workflow Editor" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">Loading workflow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <Header
        title={
          currentWorkflowId
            ? "Workflow Editor"
            : "Workflow Editor (New Workflow)"
        }
        actionButtons={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLoadDialog(true)}
              disabled={isExecuting}
            >
              <FolderOpen className="mr-1 h-4 w-4" />
              Load
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPromptImport(true)}
              disabled={isExecuting || !selectedNodeId}
            >
              <FileInput className="mr-1 h-4 w-4" />
              Import Prompt
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddAgent}
              disabled={isExecuting}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Agent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSaveDialog(true)}
              disabled={isExecuting}
            >
              <Save className="mr-1 h-4 w-4" />
              Save
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void handleRun();
                setActiveTab("run");
              }}
              disabled={isExecuting}
            >
              {isExecuting ? (
                <>
                  <StopCircle className="mr-1 h-4 w-4" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-1 h-4 w-4" />
                  Run
                </>
              )}
            </Button>
          </div>
        }
      />
      <div className="relative flex flex-1 overflow-hidden">
        <div className="min-w-0 flex-1">
          <WorkflowCanvas
            initialNodes={nodes}
            initialEdges={edges}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            onNodeClick={handleNodeClick}
            onPaneClick={handleCanvasClick}
          />
        </div>
        {/* Right Side Panel */}
        {activeTab !== null && (
          <div className="flex w-[480px] flex-shrink-0 flex-col border-l bg-background">
            {/* Tab Headers */}
            <div className="flex items-center border-b">
              <button
                className={cn(
                  "flex-1 px-4 py-2 text-sm font-medium",
                  activeTab === "config"
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground",
                )}
                onClick={() => setActiveTab("config")}
              >
                Config
              </button>
              <button
                className={cn(
                  "flex-1 px-4 py-2 text-sm font-medium",
                  activeTab === "run"
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground",
                )}
                onClick={() => setActiveTab("run")}
              >
                Run
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="mr-1 h-7 w-7"
                onClick={() => {
                  setActiveTab(null);
                  setSelectedNodeId(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
              {activeTab === "config" ? (
                selectedNodeId ? (
                  <NodeConfigPanel
                    selectedNodeId={selectedNodeId}
                    nodes={nodes}
                    edges={edges}
                    onNodeUpdate={handleNodeUpdate}
                    onClose={() => {
                      setSelectedNodeId(null);
                      setActiveTab(null);
                    }}
                    projectId={projectId}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
                    Select a node to configure
                  </div>
                )
              ) : (
                <RunPanel nodes={nodes} edges={edges} projectId={projectId} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Save Dialog */}
      <WorkflowSaveDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        onSave={handleSave}
        isSaving={isSaving}
      />

      {/* Load Dialog */}
      <WorkflowLoadDialog
        open={showLoadDialog}
        onOpenChange={setShowLoadDialog}
        workflows={workflows}
        isLoading={isLoadingWorkflows}
        onLoad={handleLoad}
      />

      {/* Prompt Import Dialog */}
      <PromptImportDialog
        open={showPromptImport}
        onOpenChange={setShowPromptImport}
        projectId={projectId}
        onImport={handlePromptImport}
      />

      {/* Workflow Output Dialog */}
      <WorkflowOutputDialog
        open={showOutputDialog}
        onOpenChange={setShowOutputDialog}
        results={workflowResults}
      />
    </div>
  );
}

export default function WorkflowEditorPage() {
  return (
    <WorkflowExecutionProvider>
      <WorkflowEditorContent />
    </WorkflowExecutionProvider>
  );
}
