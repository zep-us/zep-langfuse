import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/src/utils/tailwind";
import type { WorkflowNodeData } from "../../types";

export function InputNode({
  data,
  selected,
}: NodeProps<Node<WorkflowNodeData>>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950",
        "min-w-[200px] shadow-sm transition-all",
        selected && "ring-2 ring-green-500",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <ArrowRight className="h-4 w-4 text-green-600 dark:text-green-400" />
        <span className="text-sm font-medium text-green-900 dark:text-green-100">
          {data.label || "Input"}
        </span>
      </div>
      <div className="px-3 pb-2 text-xs text-green-700 dark:text-green-300">
        Workflow input variables
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-green-600"
      />
    </div>
  );
}
