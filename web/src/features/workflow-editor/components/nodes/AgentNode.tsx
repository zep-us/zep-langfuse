import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Bot, Loader2, Check, AlertCircle } from "lucide-react";
import { cn } from "@/src/utils/tailwind";
import type { WorkflowNodeData, AgentNodeData } from "../../types";
import { useWorkflowExecutionContext } from "../../context/WorkflowExecutionContext";

export function AgentNode({
  id,
  data,
  selected,
}: NodeProps<Node<WorkflowNodeData>>) {
  const { nodeStates } = useWorkflowExecutionContext();
  const nodeState = nodeStates.get(id);
  const agentData = data as AgentNodeData;
  const hasModel = Boolean(
    agentData.modelParams?.provider && agentData.modelParams?.model,
  );

  // Determine border color based on execution state
  const getBorderColor = () => {
    if (!nodeState) return "";
    switch (nodeState.status) {
      case "running":
        return "border-blue-500";
      case "completed":
        return "border-green-500";
      case "error":
        return "border-red-500";
      default:
        return "";
    }
  };

  // Get status icon
  const getStatusIcon = () => {
    if (!nodeState) return null;
    switch (nodeState.status) {
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "completed":
        return <Check className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-background shadow-sm transition-all",
        "min-w-[280px] max-w-[350px]",
        selected && "ring-2 ring-primary",
        !hasModel && "border-dashed border-muted-foreground/30",
        getBorderColor(),
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary" />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-lg border-b bg-muted/50 px-3 py-2">
        <Bot className="h-4 w-4 text-primary" />
        <span className="flex-1 truncate text-sm font-medium">
          {data.label}
        </span>
        {getStatusIcon()}
      </div>

      {/* Content */}
      <div className="space-y-1 px-3 py-2">
        {hasModel ? (
          <>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">
                {typeof agentData.modelParams?.provider === "object" &&
                "value" in agentData.modelParams.provider
                  ? agentData.modelParams.provider.value
                  : agentData.modelParams?.provider}
              </span>
              {": "}
              {typeof agentData.modelParams?.model === "object" &&
              "value" in agentData.modelParams.model
                ? agentData.modelParams.model.value
                : agentData.modelParams?.model}
            </div>
            {agentData.messages && agentData.messages.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {agentData.messages.length} message
                {agentData.messages.length !== 1 ? "s" : ""}
              </div>
            )}
            {agentData.tools && agentData.tools.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {agentData.tools.length} tool
                {agentData.tools.length !== 1 ? "s" : ""}
              </div>
            )}
            {agentData.inputMapping && agentData.inputMapping.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {agentData.inputMapping.length} input mapping
                {agentData.inputMapping.length !== 1 ? "s" : ""}
              </div>
            )}
          </>
        ) : (
          <div className="text-xs italic text-muted-foreground">
            Configure model and messages
          </div>
        )}

        {/* Execution state display */}
        {nodeState?.status === "error" && nodeState.error && (
          <div className="mt-1 border-t pt-1 text-xs text-red-500">
            <div className="font-medium">Error:</div>
            <div className="line-clamp-2">{nodeState.error}</div>
          </div>
        )}

        {nodeState?.status === "completed" && nodeState.output && (
          <div className="mt-1 border-t pt-1 text-xs text-muted-foreground">
            <div className="font-medium">Output:</div>
            <div className="line-clamp-3 rounded bg-muted/30 px-1 py-0.5 font-mono">
              {nodeState.output.substring(0, 200)}
              {nodeState.output.length > 200 && "..."}
            </div>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-primary"
      />
    </div>
  );
}
