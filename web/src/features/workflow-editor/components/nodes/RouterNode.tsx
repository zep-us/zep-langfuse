import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  GitBranch,
  Loader2,
  Check,
  AlertCircle,
  SkipForward,
} from "lucide-react";
import { cn } from "@/src/utils/tailwind";
import type { WorkflowNodeData, RouterNodeData } from "../../types";
import { useWorkflowExecutionContext } from "../../context/WorkflowExecutionContext";

export function RouterNode({
  id,
  data,
  selected,
}: NodeProps<Node<WorkflowNodeData>>) {
  const { nodeStates } = useWorkflowExecutionContext();
  const nodeState = nodeStates.get(id);
  const routerData = data as RouterNodeData;

  const getBorderColor = () => {
    if (!nodeState) return "";
    switch (nodeState.status) {
      case "running":
        return "border-blue-500";
      case "completed":
        return "border-green-500";
      case "error":
        return "border-red-500";
      case "skipped":
        return "border-yellow-500";
      default:
        return "";
    }
  };

  const getStatusIcon = () => {
    if (!nodeState) return null;
    switch (nodeState.status) {
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "completed":
        return <Check className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "skipped":
        return <SkipForward className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-background shadow-sm transition-all",
        "min-w-[200px] max-w-[280px]",
        "border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/20",
        selected && "ring-2 ring-primary",
        getBorderColor(),
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-amber-500" />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-lg border-b border-amber-200/50 bg-amber-100/50 px-3 py-2 dark:bg-amber-900/30">
        <GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="flex-1 truncate text-sm font-medium">
          {data.label}
        </span>
        {getStatusIcon()}
      </div>

      {/* Content */}
      <div className="space-y-1 px-3 py-2">
        {routerData.routeField ? (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Route field: </span>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              {routerData.routeField}
            </code>
          </div>
        ) : (
          <div className="text-xs italic text-muted-foreground">
            Configure route field
          </div>
        )}

        {nodeState?.status === "error" && nodeState.error && (
          <div className="mt-1 border-t pt-1 text-xs text-red-500">
            <div className="font-medium">Error:</div>
            <div className="line-clamp-2">{nodeState.error}</div>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-amber-500"
      />
    </div>
  );
}
