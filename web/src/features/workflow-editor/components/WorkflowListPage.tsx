import { useRouter } from "next/router";
import Header from "@/src/components/layouts/header";
import { Button } from "@/src/components/ui/button";
import { Plus, Play } from "lucide-react";
import { api } from "@/src/utils/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { formatDistanceToNow } from "date-fns";

export function WorkflowListPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;

  const { data: workflows, isLoading } = api.workflows.getAll.useQuery(
    { projectId },
    { enabled: Boolean(projectId) },
  );

  const handleCreateNew = () => {
    void router.push(`/project/${projectId}/workflows/new`);
  };

  const handleOpenWorkflow = (workflowId: string) => {
    void router.push(`/project/${projectId}/workflows/${workflowId}`);
  };

  return (
    <div className="flex h-screen flex-col">
      <Header
        title="Workflows"
        actionButtons={
          <Button size="sm" onClick={handleCreateNew}>
            <Plus className="mr-1 h-4 w-4" />
            New Workflow
          </Button>
        }
      />
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <p className="text-muted-foreground">Loading workflows...</p>
          </div>
        ) : workflows && workflows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Last Modified</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.map((workflow) => (
                <TableRow
                  key={workflow.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleOpenWorkflow(workflow.id)}
                >
                  <TableCell className="font-medium">{workflow.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {workflow.description || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDistanceToNow(new Date(workflow.updatedAt), {
                      addSuffix: true,
                    })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDistanceToNow(new Date(workflow.createdAt), {
                      addSuffix: true,
                    })}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenWorkflow(workflow.id)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center justify-center p-12">
            <p className="mb-4 text-muted-foreground">
              No workflows yet. Create your first workflow to get started.
            </p>
            <Button onClick={handleCreateNew}>
              <Plus className="mr-1 h-4 w-4" />
              Create Workflow
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
