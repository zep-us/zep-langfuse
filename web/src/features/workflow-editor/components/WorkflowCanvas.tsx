import { useCallback, useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type OnConnect,
  type NodeTypes,
  type EdgeTypes,
  type NodeChange,
  type EdgeChange,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AgentNode } from "./nodes/AgentNode";
import { InputNode } from "./nodes/InputNode";
import { OutputNode } from "./nodes/OutputNode";
import { CustomEdge } from "./edges/CustomEdge";
import { wouldCreateCycle } from "../utils/graphValidation";
import type { WorkflowNode, WorkflowEdge } from "../types";

interface WorkflowCanvasProps {
  initialNodes?: WorkflowNode[];
  initialEdges?: WorkflowEdge[];
  onNodesChange?: (nodes: WorkflowNode[]) => void;
  onEdgesChange?: (edges: WorkflowEdge[]) => void;
  onNodeClick?: (event: React.MouseEvent, node: WorkflowNode) => void;
  onPaneClick?: () => void;
}

export function WorkflowCanvas({
  initialNodes = [],
  initialEdges = [],
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onPaneClick,
}: WorkflowCanvasProps) {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(initialEdges);

  // Sync internal state with props when they change
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Notify parent of changes
  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowNode>[]) => {
      onNodesChangeInternal(changes);
      // Get the updated nodes directly after the state update
      if (onNodesChange) {
        setNodes((prev) => {
          onNodesChange(prev);
          return prev;
        });
      }
    },
    [onNodesChangeInternal, onNodesChange, setNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<WorkflowEdge>[]) => {
      onEdgesChangeInternal(changes);
      // Get the updated edges directly after the state update
      if (onEdgesChange) {
        setEdges((prev) => {
          onEdgesChange(prev);
          return prev;
        });
      }
    },
    [onEdgesChangeInternal, onEdgesChange, setEdges],
  );

  // Handle new connections with cycle detection
  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!connection.source || !connection.target) return;

      const newEdge = {
        source: connection.source,
        target: connection.target,
      };

      // Check for cycles
      if (wouldCreateCycle(nodes, edges, newEdge)) {
        // TODO: Add toast notification when toast system is available
        console.warn(
          "Invalid connection: This connection would create a cycle in the workflow.",
        );
        return;
      }

      setEdges((eds) => {
        const updatedEdges = addEdge(connection, eds);
        if (onEdgesChange) {
          onEdgesChange(updatedEdges);
        }
        return updatedEdges;
      });
    },
    [nodes, edges, setEdges, onEdgesChange],
  );

  // Define custom node types
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      agent: AgentNode,
      input: InputNode,
      output: OutputNode,
    }),
    [],
  );

  // Define custom edge types
  const edgeTypes: EdgeTypes = useMemo(
    () => ({
      default: CustomEdge,
    }),
    [],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode={null}
        defaultEdgeOptions={{
          animated: true,
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
          className="bg-background"
        />
      </ReactFlow>
    </div>
  );
}
