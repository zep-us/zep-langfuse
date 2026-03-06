import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/src/utils/tailwind";
import type { WorkflowNodeData } from "../../types";

export function OutputNode({
  data,
  selected,
}: NodeProps<Node<WorkflowNodeData>>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
        "min-w-[200px] shadow-sm transition-all",
        selected && "ring-2 ring-blue-500",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-600" />
      <div className="flex items-center gap-2 px-3 py-2">
        <ArrowDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
          {data.label || "Output"}
        </span>
      </div>
      <div className="px-3 pb-2 text-xs text-blue-700 dark:text-blue-300">
        Workflow output collector
      </div>
    </div>
  );
}
