import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { ArrowDown, Eye } from "lucide-react";
import { cn } from "@/src/utils/tailwind";
import type { WorkflowNodeData } from "../../types";
import { useWorkflowExecutionContext } from "../../context/WorkflowExecutionContext";
import { Button } from "@/src/components/ui/button";

export function OutputNode({
  data,
  selected,
  id,
}: NodeProps<Node<WorkflowNodeData>>) {
  const { workflowResults, setShowOutputDialog, nodeStates } =
    useWorkflowExecutionContext();

  const nodeState = nodeStates.get(id);
  const hasResults =
    workflowResults.length > 0 && nodeState?.status === "completed";

  const handleViewResults = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasResults) {
      setShowOutputDialog(true);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
        "min-w-[200px] shadow-sm transition-all",
        selected && "ring-2 ring-blue-500",
        hasResults && "cursor-pointer hover:shadow-md",
      )}
      onClick={handleViewResults}
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
      {hasResults && (
        <div className="border-t border-blue-200 bg-blue-100/50 px-3 py-2 dark:border-blue-700 dark:bg-blue-900/50">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-full text-xs text-blue-700 hover:bg-blue-200 hover:text-blue-900 dark:text-blue-300 dark:hover:bg-blue-800 dark:hover:text-blue-100"
            onClick={handleViewResults}
          >
            <Eye className="mr-1 h-3 w-3" />
            View Results
          </Button>
        </div>
      )}
    </div>
  );
}
