import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type {
  NodeExecutionState,
  ExecutionLogEntry,
  WorkflowResult,
} from "../types";

interface WorkflowExecutionContextType {
  // Execution control
  executeWorkflow: (inputVariables?: Record<string, string>) => Promise<void>;
  stopExecution: () => void;
  retryFromNode: (nodeId: string) => Promise<void>;

  // Per-node execution state
  nodeStates: Map<string, NodeExecutionState>;
  setNodeState: (nodeId: string, state: NodeExecutionState) => void;

  // Global state
  isExecuting: boolean;
  setIsExecuting: (executing: boolean) => void;
  executionLog: ExecutionLogEntry[];
  addLogEntry: (entry: ExecutionLogEntry) => void;

  // Workflow results
  workflowResults: WorkflowResult[];
  setWorkflowResults: (results: WorkflowResult[]) => void;

  // Output dialog
  showOutputDialog: boolean;
  setShowOutputDialog: (show: boolean) => void;

  // Workflow ID
  workflowId: string | null;
  setWorkflowId: (id: string | null) => void;
}

const WorkflowExecutionContext =
  createContext<WorkflowExecutionContextType | null>(null);

export function useWorkflowExecutionContext() {
  const context = useContext(WorkflowExecutionContext);
  if (!context) {
    throw new Error(
      "useWorkflowExecutionContext must be used within WorkflowExecutionProvider",
    );
  }
  return context;
}

interface WorkflowExecutionProviderProps {
  children: ReactNode;
}

export function WorkflowExecutionProvider({
  children,
}: WorkflowExecutionProviderProps) {
  const [nodeStates, setNodeStates] = useState<Map<string, NodeExecutionState>>(
    new Map(),
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLog, setExecutionLog] = useState<ExecutionLogEntry[]>([]);
  const [workflowResults, setWorkflowResults] = useState<WorkflowResult[]>([]);
  const [showOutputDialog, setShowOutputDialog] = useState(false);
  const [workflowId, setWorkflowId] = useState<string | null>(null);

  const setNodeState = useCallback(
    (nodeId: string, state: NodeExecutionState) => {
      setNodeStates((prev) => {
        const next = new Map(prev);
        next.set(nodeId, state);
        return next;
      });
    },
    [],
  );

  const addLogEntry = useCallback((entry: ExecutionLogEntry) => {
    setExecutionLog((prev) => [...prev, entry]);
  }, []);

  const executeWorkflow = useCallback(
    async (inputVariables: Record<string, string> = {}) => {
      if (isExecuting) {
        console.warn("Workflow is already executing");
        return;
      }

      setIsExecuting(true);
      setExecutionLog([]);

      // Clear previous execution states
      setNodeStates(new Map());
      setWorkflowResults([]);
    },
    [isExecuting],
  );

  const stopExecution = useCallback(() => {
    setIsExecuting(false);
    addLogEntry({
      nodeId: "system",
      timestamp: Date.now(),
      type: "error",
      message: "Execution stopped by user",
    });
  }, [addLogEntry]);

  const retryFromNode = useCallback(async (nodeId: string) => {
    // TODO: Implement retry from specific node
    console.log("Retry from node:", nodeId);
  }, []);

  return (
    <WorkflowExecutionContext.Provider
      value={{
        executeWorkflow,
        stopExecution,
        retryFromNode,
        nodeStates,
        setNodeState,
        isExecuting,
        setIsExecuting,
        executionLog,
        addLogEntry,
        workflowResults,
        setWorkflowResults,
        showOutputDialog,
        setShowOutputDialog,
        workflowId,
        setWorkflowId,
      }}
    >
      {children}
    </WorkflowExecutionContext.Provider>
  );
}
