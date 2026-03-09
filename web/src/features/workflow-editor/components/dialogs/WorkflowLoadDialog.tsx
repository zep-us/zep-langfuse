import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Loader2, FileText, Calendar } from "lucide-react";
import { cn } from "@/src/utils/tailwind";

interface Workflow {
  id: string;
  name: string;
  description: string;
  version: number;
  updatedAt: Date;
  tags: string[];
}

interface WorkflowLoadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflows: Workflow[];
  isLoading: boolean;
  onLoad: (workflowId: string) => Promise<void>;
}

export function WorkflowLoadDialog({
  open,
  onOpenChange,
  workflows,
  isLoading,
  onLoad,
}: WorkflowLoadDialogProps) {
  const handleLoad = async (workflowId: string) => {
    await onLoad(workflowId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Load Workflow</DialogTitle>
          <DialogDescription>
            Select a workflow to load into the editor
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading workflows...
              </span>
            </div>
          ) : workflows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-12 w-12 opacity-50" />
              <p className="text-sm">No workflows found</p>
              <p className="mt-1 text-xs">
                Save your first workflow to see it here
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {workflows.map((workflow) => (
                <button
                  key={workflow.id}
                  onClick={() => handleLoad(workflow.id)}
                  className={cn(
                    "w-full rounded-lg border p-4 text-left transition-colors",
                    "hover:border-primary hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="truncate font-medium">
                          {workflow.name}
                        </h4>
                        <span className="text-xs text-muted-foreground">
                          v{workflow.version}
                        </span>
                      </div>
                      {workflow.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {workflow.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>
                          Updated{" "}
                          {new Date(workflow.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      {workflow.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {workflow.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-muted px-2 py-0.5 text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="outline">
                      Load
                    </Button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
