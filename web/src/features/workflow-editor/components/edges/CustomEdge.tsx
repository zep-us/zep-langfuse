import { useCallback } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import type { WorkflowEdgeData } from "../../types";

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onEdgeDelete = useCallback(() => {
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
  }, [id, setEdges]);

  // Determine edge styling based on type
  const edgeData = data as WorkflowEdgeData | undefined;
  const edgeType = edgeData?.edgeType ?? "default";
  const conditionLabel = edgeData?.conditionLabel;

  const getStrokeColor = () => {
    if (selected) return "#3b82f6";
    switch (edgeType) {
      case "conditional":
        return "#8b5cf6"; // purple for conditional
      case "loop":
        return "#f59e0b"; // amber for loop
      default:
        return "#94a3b8";
    }
  };

  const getStrokeDasharray = () => {
    if (edgeType === "loop") return "8 4";
    return undefined;
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: selected ? 3 : 2,
          stroke: getStrokeColor(),
          strokeDasharray: getStrokeDasharray(),
        }}
      />
      <EdgeLabelRenderer>
        {/* Condition label badge */}
        {conditionLabel && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY - 16}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm ${
                edgeType === "loop"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                  : edgeType === "conditional"
                    ? "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {conditionLabel}
            </span>
          </div>
        )}

        {/* Loop iteration badge */}
        {edgeType === "loop" && edgeData?.maxIterations && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY + 12}px)`,
              pointerEvents: "none",
            }}
            className="nodrag nopan"
          >
            <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
              max {edgeData.maxIterations}x
            </span>
          </div>
        )}

        {/* Delete button when selected */}
        {selected && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <Button
              onClick={onEdgeDelete}
              size="icon"
              variant="destructive"
              className="h-6 w-6 rounded-full"
              title="Delete connection"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
