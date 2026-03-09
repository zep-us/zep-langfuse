import { useState, useRef, useEffect, useCallback } from "react";
import { useWorkflowExecutionContext } from "../../context/WorkflowExecutionContext";
import { useWorkflowExecution } from "../../hooks/useWorkflowExecution";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import {
  Send,
  Loader2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import type {
  WorkflowNode,
  WorkflowEdge,
  ChatSessionMessage,
} from "../../types";
import { cn } from "@/src/utils/tailwind";

interface RunPanelProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  projectId: string;
}

export function RunPanel({ nodes, edges, projectId }: RunPanelProps) {
  const {
    chatSession,
    setChatSession,
    resetChatSession,
    isExecuting,
    executionLog,
    clearExecutionLog,
    nodeStates,
  } = useWorkflowExecutionContext();

  const { execute } = useWorkflowExecution(projectId);
  const [inputValue, setInputValue] = useState("");
  const [showExecutionTree, setShowExecutionTree] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatSession.messages]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isExecuting) return;

    const userMessage = inputValue.trim();
    setInputValue("");

    // Add user message to chat
    const newUserMsg: ChatSessionMessage = {
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    };

    const updatedMessages = [...chatSession.messages, newUserMsg];
    const newTurnIndex = chatSession.currentTurnIndex + 1;

    // Build conversation_history string from previous messages
    const conversationHistory = chatSession.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // Compute derived boolean flags from accumulated context
    // (mirrors Python's dynamic state computation in parse_intent_node)
    const ctx = chatSession.workflowContext;
    const existingQuizzes = ctx.generated_quizzes ?? ctx.existing_quizzes;
    const hasExistingQuizzes =
      Array.isArray(existingQuizzes) && existingQuizzes.length > 0;
    const confirmedStandards = ctx.confirmed_standards;
    const hasConfirmedStandards =
      Array.isArray(confirmedStandards) && confirmedStandards.length > 0;

    // Build input variables for this turn
    const inputVariables: Record<string, string> = {
      current_message: userMessage,
      conversation_history: conversationHistory,
      message: userMessage, // alias
      has_existing_quizzes: String(hasExistingQuizzes),
      has_confirmed_standards: String(hasConfirmedStandards),
    };

    setChatSession({
      ...chatSession,
      messages: updatedMessages,
      isAwaitingInput: false,
      currentTurnIndex: newTurnIndex,
    });

    // Clear execution log for this turn so execution tree shows only current turn
    clearExecutionLog();

    try {
      // Execute workflow with previous context
      const result = await execute(
        nodes,
        edges,
        inputVariables,
        chatSession.workflowContext,
      );

      // Extract assistant response from returned outputNodeResults (avoids stale closure)
      let assistantResponse = "";
      if (result?.outputNodeResults) {
        for (const outputData of Object.values(result.outputNodeResults)) {
          try {
            const parsed = JSON.parse(outputData);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const lastResult = parsed[parsed.length - 1] as {
                output?: string;
              };
              const agentOutput = lastResult.output;
              if (agentOutput) {
                try {
                  const agentParsed = JSON.parse(agentOutput) as Record<
                    string,
                    unknown
                  >;
                  assistantResponse =
                    typeof agentParsed.response_message === "string"
                      ? agentParsed.response_message
                      : typeof agentParsed.message === "string"
                        ? agentParsed.message
                        : typeof agentParsed.proposal_message === "string"
                          ? agentParsed.proposal_message
                          : typeof agentParsed.follow_up_question === "string"
                            ? agentParsed.follow_up_question
                            : typeof agentParsed.content === "string"
                              ? agentParsed.content
                              : typeof agentParsed.response === "string"
                                ? agentParsed.response
                                : typeof agentParsed === "string"
                                  ? agentParsed
                                  : JSON.stringify(agentParsed, null, 2);
                } catch {
                  assistantResponse = agentOutput;
                }
              }
            }
          } catch {
            assistantResponse = outputData;
          }
          if (assistantResponse) break;
        }
      }

      const newContext = result?.context ?? chatSession.workflowContext;

      if (assistantResponse) {
        const assistantMsg: ChatSessionMessage = {
          role: "assistant",
          content: assistantResponse,
          timestamp: Date.now(),
        };

        const newTurn = {
          turnIndex: newTurnIndex,
          userMessage,
          executionPath: [...executionLog],
          response: assistantResponse,
        };

        setChatSession({
          messages: [...updatedMessages, assistantMsg],
          turns: [...chatSession.turns, newTurn],
          workflowContext: newContext,
          isAwaitingInput: true,
          currentTurnIndex: newTurnIndex,
        });
      } else {
        setChatSession({
          messages: updatedMessages,
          turns: chatSession.turns,
          workflowContext: newContext,
          isAwaitingInput: true,
          currentTurnIndex: newTurnIndex,
        });
      }
    } catch (error) {
      const errorMsg: ChatSessionMessage = {
        role: "system",
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        timestamp: Date.now(),
      };
      setChatSession({
        messages: [...updatedMessages, errorMsg],
        turns: chatSession.turns,
        workflowContext: chatSession.workflowContext,
        isAwaitingInput: true,
        currentTurnIndex: newTurnIndex,
      });
    }
  }, [
    inputValue,
    isExecuting,
    chatSession,
    nodes,
    edges,
    execute,
    setChatSession,
    clearExecutionLog,
    executionLog,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  // Current turn's execution log
  const currentTurnLog = executionLog.filter((log) => log.nodeId !== "system");

  return (
    <div className="flex h-full flex-col">
      {/* Execution Tree (collapsible) */}
      <div className="border-b">
        <button
          className="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-muted/50"
          onClick={() => setShowExecutionTree(!showExecutionTree)}
        >
          {showExecutionTree ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Execution Tree
          {isExecuting && (
            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
          )}
        </button>
        {showExecutionTree && (
          <div className="max-h-48 overflow-y-auto px-4 pb-3">
            {currentTurnLog.length === 0 ? (
              <div className="py-2 text-xs text-muted-foreground">
                Send a message to start the workflow
              </div>
            ) : (
              <div className="space-y-1">
                {currentTurnLog.map((log, i) => {
                  const node = nodes.find((n) => n.id === log.nodeId);
                  const state = nodeStates.get(log.nodeId);
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "h-2 w-2 flex-shrink-0 rounded-full",
                          state?.status === "running" &&
                            "animate-pulse bg-blue-500",
                          state?.status === "completed" && "bg-green-500",
                          state?.status === "error" && "bg-red-500",
                          state?.status === "skipped" && "bg-yellow-500",
                          state?.status === "pending" && "bg-gray-300",
                        )}
                      />
                      <span className="truncate font-mono text-muted-foreground">
                        {node?.data.label ?? log.nodeId}
                      </span>
                      {log.type === "complete" && (
                        <span className="text-green-600">&#x2713;</span>
                      )}
                      {log.type === "error" && (
                        <span className="truncate text-red-600">
                          {log.message}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {chatSession.messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Type a message to start testing the workflow
          </div>
        )}
        {chatSession.messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : msg.role === "system"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted",
              )}
            >
              <div className="whitespace-pre-wrap break-words">
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {isExecuting && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-muted px-3 py-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t p-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={resetChatSession}
            title="Reset conversation"
            className="flex-shrink-0"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={isExecuting}
            className="flex-1"
          />
          <Button
            size="icon"
            onClick={() => void handleSendMessage()}
            disabled={!inputValue.trim() || isExecuting}
            className="flex-shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
