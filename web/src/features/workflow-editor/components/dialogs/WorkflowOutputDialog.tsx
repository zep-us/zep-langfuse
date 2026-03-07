import { useTheme } from "next-themes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/src/components/ui/dialog";
import { default as React18JsonView } from "react18-json-view";
import "react18-json-view/src/dark.css";
import { FileText } from "lucide-react";
import { cn } from "@/src/utils/tailwind";
import type { WorkflowResult } from "../../types";

interface WorkflowOutputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: WorkflowResult[];
}

export function WorkflowOutputDialog({
  open,
  onOpenChange,
  results,
}: WorkflowOutputDialogProps) {
  const { resolvedTheme } = useTheme();

  const parseOutput = (output: string): unknown => {
    try {
      return JSON.parse(output);
    } catch {
      return output;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Workflow Execution Results</DialogTitle>
          <DialogDescription>
            View the output from each node in the workflow execution
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="mb-3 h-12 w-12 opacity-50" />
              <p className="text-sm">No results available</p>
              <p className="mt-1 text-xs">
                Execute the workflow to see results here
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {results.map((result, index) => {
                const parsedOutput = parseOutput(result.output);
                const isJsonOutput = typeof parsedOutput === "object";

                return (
                  <div
                    key={`${result.nodeId}-${index}`}
                    className="rounded-lg border"
                  >
                    <div className="border-b bg-muted/50 px-4 py-2">
                      <h4 className="text-sm font-medium">
                        Node: {result.nodeId}
                      </h4>
                    </div>
                    <div className="p-4">
                      {isJsonOutput ? (
                        <div className="rounded-md border bg-background">
                          <React18JsonView
                            src={parsedOutput}
                            theme="github"
                            dark={resolvedTheme === "dark"}
                            collapsed={false}
                            collapseObjectsAfterLength={20}
                            collapseStringsAfterLength={500}
                            collapseStringMode="word"
                            displaySize="expanded"
                            matchesURL={true}
                            className="w-full p-2 text-xs"
                          />
                        </div>
                      ) : (
                        <code
                          className={cn(
                            "block whitespace-pre-wrap break-words rounded-md border",
                            "bg-background px-4 py-3 font-mono text-xs",
                          )}
                          dir="auto"
                          style={{ unicodeBidi: "plaintext" }}
                        >
                          {result.output}
                        </code>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
