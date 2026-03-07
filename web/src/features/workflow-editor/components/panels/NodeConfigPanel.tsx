import { X, Plus, Trash2 } from "lucide-react";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { ModelParameters } from "@/src/components/ModelParameters";
import { ChatMessages } from "@/src/components/ChatMessages";
import type { MessagesContext } from "@/src/components/ChatMessages/types";
import type {
  WorkflowNode,
  WorkflowNodeData,
  WorkflowEdge,
  FieldMapping,
} from "../../types";
import type {
  ChatMessage,
  ChatMessageWithId,
  PlaceholderMessage,
  UIModelParams,
} from "@langfuse/shared";
import { LLMAdapter, supportedModels } from "@langfuse/shared";
import { createEmptyMessage } from "@/src/components/ChatMessages/utils/createEmptyMessage";
import { v4 as uuidv4 } from "uuid";

interface NodeConfigPanelProps {
  selectedNodeId: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onNodeUpdate: (nodeId: string, updates: Partial<WorkflowNodeData>) => void;
  onClose: () => void;
}

export function NodeConfigPanel({
  selectedNodeId,
  nodes,
  edges,
  onNodeUpdate,
  onClose,
}: NodeConfigPanelProps) {
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  // Local state for messages - convert ChatMessage[] to ChatMessageWithId[]
  const [messages, setMessages] = useState<ChatMessageWithId[]>([]);

  // Debounce timer for message updates
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync messages when node changes (only when node ID changes, not when messages change)
  useEffect(() => {
    if (selectedNode?.data.messages) {
      const messagesWithIds = selectedNode.data.messages.map((msg) => {
        // Check if message already has an id (it's ChatMessageWithId)
        if ("id" in msg && typeof msg.id === "string") {
          return msg as ChatMessageWithId;
        }
        // Add id to ChatMessage
        return { ...msg, id: uuidv4() } as ChatMessageWithId;
      });
      setMessages(messagesWithIds);
    } else {
      setMessages([]);
    }
    // Only depend on node ID, not messages - we manage messages locally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

  // Helper to strip ids and type from messages
  const stripMessageIds = useCallback(
    (msgs: ChatMessageWithId[]): ChatMessage[] => {
      return msgs
        .filter((msg) => "role" in msg && "content" in msg) // Filter out placeholders first
        .map(({ id, ...rest }) => rest as ChatMessage);
    },
    [],
  );

  // Memoized message context functions to prevent unnecessary re-renders
  const handleSetMessages = useCallback(
    (newMessages: ChatMessageWithId[]) => {
      if (!selectedNode) return;
      setMessages(newMessages);
      onNodeUpdate(selectedNode.id, { messages: stripMessageIds(newMessages) });
    },
    [selectedNode, onNodeUpdate, stripMessageIds],
  );

  const handleAddMessage = useCallback(
    (message: ChatMessage | PlaceholderMessage) => {
      if (!selectedNode) return createEmptyMessage(message as ChatMessage);
      const newMessage = createEmptyMessage(message as ChatMessage);
      setMessages((prev) => {
        const updatedMessages = [...prev, newMessage];
        onNodeUpdate(selectedNode.id, {
          messages: stripMessageIds(updatedMessages),
        });
        return updatedMessages;
      });
      return newMessage;
    },
    [selectedNode, onNodeUpdate, stripMessageIds],
  );

  const handleDeleteMessage = useCallback(
    (id: string) => {
      if (!selectedNode) return;
      setMessages((prev) => {
        const updatedMessages = prev.filter((m) => m.id !== id);
        onNodeUpdate(selectedNode.id, {
          messages: stripMessageIds(updatedMessages),
        });
        return updatedMessages;
      });
    },
    [selectedNode, onNodeUpdate, stripMessageIds],
  );

  const handleUpdateMessage = useCallback(
    <
      T extends ChatMessageWithId["type"],
      Key extends keyof Omit<
        Extract<ChatMessageWithId, { type: T }>,
        "id" | "type"
      >,
      Value = Extract<ChatMessageWithId, { type: T }>[Key],
    >(
      type: T,
      id: string,
      key: Key,
      value: Value,
    ) => {
      if (!selectedNode) return;
      setMessages((prev) => {
        const updatedMessages = prev.map((m) => {
          if (m.id === id && m.type === type) {
            return { ...m, [key]: value };
          }
          return m;
        });

        // Debounce the parent update to avoid re-renders during typing
        if (updateTimerRef.current) {
          clearTimeout(updateTimerRef.current);
        }

        updateTimerRef.current = setTimeout(() => {
          onNodeUpdate(selectedNode.id, {
            messages: stripMessageIds(updatedMessages),
          });
        }, 300);

        return updatedMessages;
      });
    },
    [selectedNode, onNodeUpdate, stripMessageIds],
  );

  const handleReplaceMessage = useCallback(
    (id: string, message: ChatMessage) => {
      if (!selectedNode) return;
      setMessages((prev) => {
        const updatedMessages = prev.map((m) =>
          m.id === id ? ({ ...message, id } as ChatMessageWithId) : m,
        );
        onNodeUpdate(selectedNode.id, {
          messages: stripMessageIds(updatedMessages),
        });
        return updatedMessages;
      });
    },
    [selectedNode, onNodeUpdate, stripMessageIds],
  );

  // Messages context for ChatMessages component
  const messagesContext: MessagesContext = useMemo(
    () => ({
      messages,
      setMessages: handleSetMessages,
      addMessage: handleAddMessage,
      deleteMessage: handleDeleteMessage,
      updateMessage: handleUpdateMessage,
      replaceMessage: handleReplaceMessage,
    }),
    [
      messages,
      handleSetMessages,
      handleAddMessage,
      handleDeleteMessage,
      handleUpdateMessage,
      handleReplaceMessage,
    ],
  );

  // Get upstream nodes (nodes that have edges pointing to this node)
  const upstreamNodes = useMemo(() => {
    if (!selectedNode) return [];
    const upstreamNodeIds = edges
      .filter((edge) => edge.target === selectedNode.id)
      .map((edge) => edge.source);
    return nodes.filter((node) => upstreamNodeIds.includes(node.id));
  }, [selectedNode, edges, nodes]);

  // Input mapping handlers
  const handleAddInputMapping = useCallback(() => {
    if (!selectedNode) return;
    const newMapping: FieldMapping = {
      sourceField: "",
      targetVariable: "",
      mappingType: "full",
    };
    const nodeData = selectedNode.data;
    onNodeUpdate(selectedNode.id, {
      inputMapping: [...(nodeData.inputMapping ?? []), newMapping],
    });
  }, [selectedNode, nodes, onNodeUpdate]);

  const handleUpdateInputMapping = useCallback(
    (index: number, updates: Partial<FieldMapping>) => {
      if (!selectedNode) return;
      const nodeData = selectedNode.data;
      const updatedMappings = [...(nodeData.inputMapping ?? [])];
      updatedMappings[index] = { ...updatedMappings[index]!, ...updates };
      onNodeUpdate(selectedNode.id, { inputMapping: updatedMappings });
    },
    [selectedNode, nodes, onNodeUpdate],
  );

  const handleRemoveInputMapping = useCallback(
    (index: number) => {
      if (!selectedNode) return;
      const nodeData = selectedNode.data;
      const updatedMappings = (nodeData.inputMapping ?? []).filter(
        (_, i) => i !== index,
      );
      onNodeUpdate(selectedNode.id, { inputMapping: updatedMappings });
    },
    [selectedNode, nodes, onNodeUpdate],
  );

  // Early return after all hooks
  if (!selectedNode || selectedNode.type !== "agent") {
    return null;
  }

  const nodeData = selectedNode.data;

  // Update label
  const handleLabelChange = (label: string) => {
    onNodeUpdate(selectedNode.id, { label });
  };

  // Update retry config
  const handleRetryConfigChange = (
    field: "maxRetries" | "retryDelay",
    value: number,
  ) => {
    onNodeUpdate(selectedNode.id, {
      retryConfig: {
        maxRetries: nodeData.retryConfig?.maxRetries ?? 3,
        retryDelay: nodeData.retryConfig?.retryDelay ?? 1000,
        [field]: value,
      },
    });
  };

  // Get available providers and models
  const availableProviders = Object.keys(supportedModels);
  const currentProvider = nodeData.modelParams?.provider || LLMAdapter.OpenAI;
  const providerValue =
    typeof currentProvider === "object" && "value" in currentProvider
      ? currentProvider.value
      : currentProvider;

  const availableModels = [
    ...(supportedModels[providerValue as LLMAdapter] || []),
  ];

  // Create provider-model combinations for compact view
  const providerModelCombinations = availableProviders.flatMap((provider) =>
    [...(supportedModels[provider as LLMAdapter] || [])].map(
      (model) => `${provider}: ${model}`,
    ),
  );

  // Helper to get complete default model params
  const getDefaultModelParams = (): UIModelParams => ({
    provider: { value: LLMAdapter.OpenAI, enabled: true },
    model: { value: "gpt-4", enabled: true },
    adapter: { value: LLMAdapter.OpenAI, enabled: true },
    temperature: { value: 1, enabled: false },
    max_tokens: { value: 2048, enabled: false },
    top_p: { value: 1, enabled: false },
    maxTemperature: { value: 2, enabled: true },
    maxReasoningTokens: { value: 0, enabled: false },
    providerOptions: { value: {}, enabled: false },
  });

  // Helper to merge node params with defaults (deep merge each field)
  const getCompleteModelParams = (): UIModelParams => {
    const defaults = getDefaultModelParams();
    if (!nodeData.modelParams) return defaults;

    // Deep merge: for each field, use node value if exists, otherwise default
    return { ...defaults, ...nodeData.modelParams } as UIModelParams;
  };

  // Handle model param updates
  const updateModelParamValue = (
    key: keyof UIModelParams,
    value: string | number | Record<string, unknown>,
  ) => {
    const currentModelParams = getCompleteModelParams();

    const updatedParams = {
      ...currentModelParams,
      [key]: {
        ...currentModelParams[key],
        value,
      },
    };

    onNodeUpdate(selectedNode.id, {
      modelParams: updatedParams,
    });
  };

  return (
    <div className="fixed right-0 top-0 z-50 flex h-full w-[600px] flex-col border-l bg-background shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-lg font-semibold">Node Configuration</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {/* Label */}
        <div className="space-y-2">
          <Label htmlFor="node-label">Label</Label>
          <Input
            id="node-label"
            value={nodeData.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Node label"
          />
        </div>

        {/* Model Configuration */}
        <div className="space-y-2">
          <Label>Model</Label>
          <ModelParameters
            modelParams={getCompleteModelParams()}
            availableProviders={availableProviders}
            availableModels={availableModels}
            providerModelCombinations={providerModelCombinations}
            updateModelParamValue={updateModelParamValue}
            layout="vertical"
            isEmbedded
          />
        </div>

        {/* Messages */}
        <div className="space-y-2">
          <Label>Messages</Label>
          <div className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-3">
            <ChatMessages {...messagesContext} />
          </div>
        </div>

        {/* Input Mapping */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Input Mapping</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddInputMapping}
              disabled={upstreamNodes.length === 0}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add Mapping
            </Button>
          </div>

          {upstreamNodes.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Connect upstream nodes to add input mappings
            </div>
          ) : (
            <div className="space-y-3">
              {(nodeData.inputMapping ?? []).map((mapping, index) => (
                <div
                  key={index}
                  className="space-y-2 rounded-md border bg-muted/30 p-3"
                >
                  <div className="flex items-start justify-between">
                    <Label className="text-xs font-normal">
                      Mapping {index + 1}
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleRemoveInputMapping(index)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Source Node Selection */}
                  <div className="space-y-1">
                    <Label htmlFor={`source-node-${index}`} className="text-xs">
                      Source Node
                    </Label>
                    <Select
                      value={mapping.sourceField.split(".")[0] ?? ""}
                      onValueChange={(nodeId) => {
                        const fieldPath = mapping.sourceField.split(".")[1];
                        handleUpdateInputMapping(index, {
                          sourceField: fieldPath
                            ? `${nodeId}.${fieldPath}`
                            : `${nodeId}.output`,
                        });
                      }}
                    >
                      <SelectTrigger id={`source-node-${index}`}>
                        <SelectValue placeholder="Select source node" />
                      </SelectTrigger>
                      <SelectContent>
                        {upstreamNodes.map((node) => (
                          <SelectItem key={node.id} value={node.id}>
                            {node.data.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Field Path */}
                  <div className="space-y-1">
                    <Label htmlFor={`field-path-${index}`} className="text-xs">
                      Field Path (optional, e.g., "output.topic")
                    </Label>
                    <Input
                      id={`field-path-${index}`}
                      placeholder="output (default)"
                      value={
                        mapping.sourceField.split(".").slice(1).join(".") || ""
                      }
                      onChange={(e) => {
                        const nodeId = mapping.sourceField.split(".")[0];
                        const fieldPath = e.target.value.trim();
                        handleUpdateInputMapping(index, {
                          sourceField: fieldPath
                            ? `${nodeId}.${fieldPath}`
                            : `${nodeId}.output`,
                        });
                      }}
                    />
                  </div>

                  {/* Target Variable */}
                  <div className="space-y-1">
                    <Label htmlFor={`target-var-${index}`} className="text-xs">
                      Variable Name (use in messages as {`{{name}}`})
                    </Label>
                    <Input
                      id={`target-var-${index}`}
                      placeholder="e.g., topic"
                      value={mapping.targetVariable}
                      onChange={(e) =>
                        handleUpdateInputMapping(index, {
                          targetVariable: e.target.value,
                        })
                      }
                    />
                  </div>

                  {/* Mapping Type */}
                  <div className="space-y-1">
                    <Label className="text-xs">Mapping Type</Label>
                    <Select
                      value={mapping.mappingType}
                      onValueChange={(value: "full" | "field") =>
                        handleUpdateInputMapping(index, {
                          mappingType: value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">
                          Full Output (entire result)
                        </SelectItem>
                        <SelectItem value="field">
                          Field Extraction (specific field)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}

              {(nodeData.inputMapping ?? []).length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No input mappings configured. Click "Add Mapping" to create
                  one.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tools Configuration (placeholder) */}
        {nodeData.tools && nodeData.tools.length > 0 && (
          <div className="space-y-2">
            <Label>Tools</Label>
            <div className="text-xs text-muted-foreground">
              {nodeData.tools.length} tool
              {nodeData.tools.length !== 1 ? "s" : ""} configured
            </div>
          </div>
        )}

        {/* Retry Configuration */}
        <div className="space-y-4">
          <Label>Retry Configuration</Label>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="max-retries" className="text-xs font-normal">
                Max Retries
              </Label>
              <Input
                id="max-retries"
                type="number"
                min={0}
                max={10}
                value={nodeData.retryConfig?.maxRetries ?? 3}
                onChange={(e) =>
                  handleRetryConfigChange(
                    "maxRetries",
                    parseInt(e.target.value) || 0,
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retry-delay" className="text-xs font-normal">
                Retry Delay (ms)
              </Label>
              <Input
                id="retry-delay"
                type="number"
                min={0}
                step={100}
                value={nodeData.retryConfig?.retryDelay ?? 1000}
                onChange={(e) =>
                  handleRetryConfigChange(
                    "retryDelay",
                    parseInt(e.target.value) || 0,
                  )
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
