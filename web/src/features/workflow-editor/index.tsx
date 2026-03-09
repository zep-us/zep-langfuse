import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/router";
import Header from "@/src/components/layouts/header";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { Button } from "@/src/components/ui/button";
import {
  Plus,
  Play,
  Save,
  StopCircle,
  FolderOpen,
  FileInput,
  Clock,
  CheckCircle2,
  XCircle,
  GitBranch,
} from "lucide-react";
import type { WorkflowNode, WorkflowEdge, WorkflowNodeData } from "./types";
import {
  WorkflowExecutionProvider,
  useWorkflowExecutionContext,
} from "./context/WorkflowExecutionContext";
import { useWorkflowExecution } from "./hooks/useWorkflowExecution";
import { useWorkflowPersistence } from "./hooks/useWorkflowPersistence";
import { WorkflowSaveDialog } from "./components/dialogs/WorkflowSaveDialog";
import { WorkflowLoadDialog } from "./components/dialogs/WorkflowLoadDialog";
import { NodeConfigPanel } from "./components/panels/NodeConfigPanel";
import { PromptImportDialog } from "./components/dialogs/PromptImportDialog";
import { WorkflowOutputDialog } from "./components/dialogs/WorkflowOutputDialog";
import { ChatMessageType, ChatMessageRole, LLMAdapter } from "@langfuse/shared";
import type {
  PromptChatMessageSchema,
  UIModelParams,
  ChatMessage,
} from "@langfuse/shared";
import { z } from "zod/v4";
import { formatDistanceToNow } from "date-fns";

type PromptMessage = z.infer<typeof PromptChatMessageSchema>;

function WorkflowEditorContent() {
  const router = useRouter();
  const projectId = router.query.projectId as string;
  const {
    workflowResults,
    showOutputDialog,
    setShowOutputDialog,
    setWorkflowId,
    setWorkflowResults,
  } = useWorkflowExecutionContext();

  const [nodes, setNodes] = useState<WorkflowNode[]>([
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
  ]);

  const [edges, setEdges] = useState<WorkflowEdge[]>([
    { id: "e-input-agent", source: "input-1", target: "agent-1" },
    { id: "e-agent-output", source: "agent-1", target: "output-1" },
  ]);

  const { execute, isExecuting } = useWorkflowExecution(projectId);

  // Set workflowId from router query
  useEffect(() => {
    const queryWorkflowId = router.query.workflowId as string | undefined;
    setWorkflowId(queryWorkflowId ?? null);
  }, [router.query.workflowId, setWorkflowId]);

  // Load execution history when workflow is loaded
  const [lastExecutionAt, setLastExecutionAt] = useState<Date | null>(null);
  const [lastExecutionStatus, setLastExecutionStatus] = useState<
    "success" | "error" | "pending" | null
  >(null);

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showPromptImport, setShowPromptImport] = useState(false);

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

  const handleAddRouter = useCallback(() => {
    const newNode: WorkflowNode = {
      id: `router-${Date.now()}`,
      type: "router",
      position: { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 },
      data: {
        label: `Router ${nodes.filter((n) => n.type === "router").length + 1}`,
        routeField: "output",
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
    },
    [save],
  );

  const handleLoad = useCallback(
    async (workflowId: string) => {
      const workflow = await load(workflowId);

      // Load execution history if it exists
      if (workflow?.lastExecutionResults) {
        try {
          const results = workflow.lastExecutionResults as unknown as Array<{
            nodeId: string;
            output: string;
          }>;
          setWorkflowResults(results);

          // Optionally auto-open output dialog if results exist
          // Uncomment the line below to enable auto-open:
          // setShowOutputDialog(true);
        } catch (error) {
          console.error("Failed to parse execution results:", error);
        }
      }

      // Set execution metadata
      if (workflow?.lastExecutionAt) {
        setLastExecutionAt(workflow.lastExecutionAt);
      }
      if (workflow?.lastExecutionStatus) {
        setLastExecutionStatus(
          workflow.lastExecutionStatus as "success" | "error" | "pending",
        );
      }
    },
    [load, setWorkflowResults],
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
    },
    [],
  );

  const handleCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

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

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Workflow Editor"
        help={{
          description:
            "Build multi-agent workflows by connecting nodes. Import prompts, configure agents, and execute workflows.",
        }}
        actionButtons={
          <div className="flex items-center gap-4">
            {/* Last Execution Info */}
            {lastExecutionAt && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {lastExecutionStatus === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : lastExecutionStatus === "error" ? (
                  <XCircle className="h-4 w-4 text-red-600" />
                ) : (
                  <Clock className="h-4 w-4" />
                )}
                <span>
                  Last run:{" "}
                  {formatDistanceToNow(new Date(lastExecutionAt), {
                    addSuffix: true,
                  })}
                </span>
                {workflowResults.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowOutputDialog(true)}
                    className="h-auto p-1 text-xs"
                  >
                    View Results
                  </Button>
                )}
              </div>
            )}
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
                onClick={handleAddRouter}
                disabled={isExecuting}
              >
                <GitBranch className="mr-1 h-4 w-4" />
                Add Router
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
              <Button size="sm" onClick={handleRun} disabled={isExecuting}>
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
          </div>
        }
      />
      <div className="flex-1 overflow-hidden">
        <WorkflowCanvas
          initialNodes={nodes}
          initialEdges={edges}
          onNodesChange={setNodes}
          onEdgesChange={setEdges}
          onNodeClick={handleNodeClick}
          onPaneClick={handleCanvasClick}
        />
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

      {/* Node Configuration Panel */}
      {selectedNodeId && (
        <NodeConfigPanel
          selectedNodeId={selectedNodeId}
          nodes={nodes}
          edges={edges}
          onNodeUpdate={handleNodeUpdate}
          onClose={() => setSelectedNodeId(null)}
          projectId={projectId}
        />
      )}

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
