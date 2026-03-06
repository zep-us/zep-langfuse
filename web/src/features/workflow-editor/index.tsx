import { useState, useCallback } from "react";
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
} from "lucide-react";
import type { WorkflowNode, WorkflowEdge, WorkflowNodeData } from "./types";
import { WorkflowExecutionProvider } from "./context/WorkflowExecutionContext";
import { useWorkflowExecution } from "./hooks/useWorkflowExecution";
import { useWorkflowPersistence } from "./hooks/useWorkflowPersistence";
import { WorkflowSaveDialog } from "./components/dialogs/WorkflowSaveDialog";
import { WorkflowLoadDialog } from "./components/dialogs/WorkflowLoadDialog";
import { NodeConfigPanel } from "./components/panels/NodeConfigPanel";
import { PromptImportDialog } from "./components/dialogs/PromptImportDialog";
import { ChatMessageType, ChatMessageRole, LLMAdapter } from "@langfuse/shared";
import type { PromptChatMessageSchema } from "@langfuse/shared";
import { z } from "zod/v4";

type PromptMessage = z.infer<typeof PromptChatMessageSchema>;

function WorkflowEditorContent() {
  const router = useRouter();
  const projectId = router.query.projectId as string;

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
      await load(workflowId);
    },
    [load],
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
          messages: promptData.messages as any,
          modelParams: promptData.modelParams as any,
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
          onNodeUpdate={handleNodeUpdate}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

export default function WorkflowEditorPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;

  const handleExecute = useCallback(
    async (inputVariables: Record<string, string>) => {
      // This will be implemented by the WorkflowEditorContent component
      console.log("Execute with variables:", inputVariables);
    },
    [],
  );

  return (
    <WorkflowExecutionProvider onExecute={handleExecute}>
      <WorkflowEditorContent />
    </WorkflowExecutionProvider>
  );
}
