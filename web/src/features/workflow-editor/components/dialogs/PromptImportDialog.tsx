import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Loader2, FileText, Search } from "lucide-react";
import { cn } from "@/src/utils/tailwind";
import { api } from "@/src/utils/api";
import type { PromptChatMessageSchema } from "@langfuse/shared";
import { z } from "zod/v4";

type PromptMessage = z.infer<typeof PromptChatMessageSchema>;

interface PromptImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onImport: (promptData: {
    messages: PromptMessage[];
    modelParams: Record<string, unknown>;
  }) => void;
}

export function PromptImportDialog({
  open,
  onOpenChange,
  projectId,
  onImport,
}: PromptImportDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);

  // Fetch all prompt names
  const { data: promptNames, isLoading: isLoadingNames } =
    api.prompts.allPromptMeta.useQuery(
      { projectId },
      { enabled: open && Boolean(projectId) },
    );

  // Fetch full prompt data when a prompt is selected
  const { data: fullPrompt, isLoading: isLoadingPrompt } =
    api.prompts.byId.useQuery(
      {
        projectId,
        id: selectedPromptId ?? "",
      },
      {
        enabled: Boolean(selectedPromptId && projectId),
      },
    );

  // Filter prompts based on search query
  const filteredPrompts =
    promptNames?.filter((prompt) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        prompt.name.toLowerCase().includes(query) ||
        prompt.labels.some((label) => label.toLowerCase().includes(query)) ||
        prompt.version.toString().includes(query)
      );
    }) ?? [];

  const handleImport = () => {
    if (!fullPrompt) return;

    // Only support chat prompts for now
    if (fullPrompt.type !== "chat") {
      return;
    }

    // Parse the prompt as an array of messages
    const messages = Array.isArray(fullPrompt.prompt)
      ? (fullPrompt.prompt as PromptMessage[])
      : [];

    onImport({
      messages,
      modelParams: (fullPrompt.config as Record<string, unknown>) ?? {},
    });

    onOpenChange(false);
    setSelectedPromptId(null);
    setSearchQuery("");
  };

  const handleSelectPrompt = (promptId: string) => {
    setSelectedPromptId(promptId);
  };

  const handleBack = () => {
    setSelectedPromptId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Import Prompt</DialogTitle>
          <DialogDescription>
            Select a prompt to import its messages and configuration
          </DialogDescription>
        </DialogHeader>

        {selectedPromptId ? (
          // Detail view for selected prompt
          <div className="space-y-4">
            {isLoadingPrompt ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Loading prompt details...
                </span>
              </div>
            ) : fullPrompt ? (
              <>
                <div className="space-y-3 rounded-lg border p-4">
                  <div>
                    <h3 className="text-lg font-semibold">{fullPrompt.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      Version {fullPrompt.version}
                    </p>
                  </div>

                  {fullPrompt.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {fullPrompt.labels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-muted px-2 py-0.5 text-xs"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="text-sm">
                    <p className="mb-1 font-medium">Type:</p>
                    <p className="capitalize text-muted-foreground">
                      {fullPrompt.type}
                    </p>
                  </div>

                  {fullPrompt.type === "chat" && (
                    <div className="text-sm">
                      <p className="mb-1 font-medium">Messages:</p>
                      <p className="text-muted-foreground">
                        {Array.isArray(fullPrompt.prompt)
                          ? fullPrompt.prompt.length
                          : 0}{" "}
                        message(s)
                      </p>
                    </div>
                  )}

                  {fullPrompt.config &&
                    Object.keys(fullPrompt.config as object).length > 0 && (
                      <div className="text-sm">
                        <p className="mb-1 font-medium">Configuration:</p>
                        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                          {JSON.stringify(fullPrompt.config, null, 2)}
                        </pre>
                      </div>
                    )}
                </div>

                {fullPrompt.type !== "chat" && (
                  <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-600 dark:bg-amber-950">
                    Only chat prompts can be imported into workflow nodes.
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleBack}>
                    Back
                  </Button>
                  <Button
                    onClick={handleImport}
                    disabled={fullPrompt.type !== "chat"}
                  >
                    Import Prompt
                  </Button>
                </div>
              </>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <p className="text-sm">Prompt not found</p>
              </div>
            )}
          </div>
        ) : (
          // List view
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
              <Input
                placeholder="Search prompts by name, label, or version..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-[50vh] overflow-y-auto">
              {isLoadingNames ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Loading prompts...
                  </span>
                </div>
              ) : filteredPrompts.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-12 w-12 opacity-50" />
                  <p className="text-sm">
                    {searchQuery
                      ? "No prompts match your search"
                      : "No prompts found"}
                  </p>
                  <p className="mt-1 text-xs">
                    {searchQuery
                      ? "Try a different search term"
                      : "Create prompts in the Prompts section"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredPrompts.map((prompt) => (
                    <button
                      key={prompt.id}
                      onClick={() => handleSelectPrompt(prompt.id)}
                      className={cn(
                        "w-full rounded-lg border p-4 text-left transition-colors",
                        "hover:border-primary hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="truncate font-medium">
                              {prompt.name}
                            </h4>
                            <span className="text-xs text-muted-foreground">
                              v{prompt.version}
                            </span>
                            <span
                              className={cn(
                                "rounded px-2 py-0.5 text-xs capitalize",
                                prompt.type === "chat"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                                  : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
                              )}
                            >
                              {prompt.type}
                            </span>
                          </div>

                          {prompt.labels.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {prompt.labels.map((label) => (
                                <span
                                  key={label}
                                  className="rounded-full bg-muted px-2 py-0.5 text-xs"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
