import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, RefreshCw, Send, StepForward } from "lucide-react";
import {
  createIssue,
  fetchAssignedIssues,
  fetchMyIssues,
  IssueTarget,
  updateIssueStatus,
} from "@/api/issueApi";
import { fetchUsers } from "@/api/adminApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { issueQueryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { Issue, IssuePriority, IssueStatus } from "@/types";

const priorities: IssuePriority[] = ["LOW", "MEDIUM", "HIGH"];
const statusFlow: IssueStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

function nextIssueStatus(status: IssueStatus) {
  const index = statusFlow.indexOf(status);
  return index >= 0 ? statusFlow[index + 1] : undefined;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusClass(status: IssueStatus) {
  if (status === "CLOSED") {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }

  if (status === "RESOLVED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "IN_PROGRESS") {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }

  return "border-amber-200 bg-amber-50 text-amber-900";
}

function priorityClass(priority: IssuePriority) {
  if (priority === "HIGH") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  if (priority === "LOW") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  return "border-sky-200 bg-sky-50 text-sky-800";
}

function IssueList({
  issues,
  loading,
  onAdvance,
  advancing,
  currentUserId,
  isAdmin,
}: {
  issues: Issue[] | undefined;
  loading: boolean;
  onAdvance: (issue: Issue) => void;
  advancing: boolean;
  currentUserId?: string;
  isAdmin: boolean;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading issues...</p>;
  }

  if (!issues || issues.length === 0) {
    return <p className="text-sm text-muted-foreground">No issues found.</p>;
  }

  return (
    <div className="space-y-3">
      {issues.map((issue) => {
        const nextStatus = nextIssueStatus(issue.status);
        const canAdvance = Boolean(nextStatus && (isAdmin || issue.assigned_to === currentUserId));

        return (
          <div key={issue.id} className="rounded-md border p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{issue.title}</h3>
                  <Badge variant="outline" className={cn(statusClass(issue.status))}>
                    {issue.status.replace("_", " ")}
                  </Badge>
                  <Badge variant="outline" className={cn(priorityClass(issue.priority))}>
                    {issue.priority}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{issue.description}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Created by {issue.creator?.name || issue.created_by}</span>
                  <span>Assigned to {issue.assignee?.name || issue.assigned_to}</span>
                  <span>{formatDateTime(issue.created_at)}</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canAdvance || advancing}
                onClick={() => onAdvance(issue)}
              >
                <StepForward className="h-4 w-4 mr-2" />
                {nextStatus ? nextStatus.replace("_", " ") : "Closed"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Issues() {
  const queryClient = useQueryClient();
  const { user, role } = useAuth();
  const isAdmin = role?.hierarchy_level === 1;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<IssuePriority>("MEDIUM");
  const [target, setTarget] = useState<IssueTarget>("higher_ups");
  const [assignedTo, setAssignedTo] = useState("");

  const usersQuery = useQuery({
    queryKey: ["issues", "target-users"],
    queryFn: () => fetchUsers("accessible"),
  });

  const myIssuesQuery = useQuery({
    queryKey: issueQueryKeys.my,
    queryFn: fetchMyIssues,
  });

  const assignedIssuesQuery = useQuery({
    queryKey: issueQueryKeys.assigned,
    queryFn: fetchAssignedIssues,
  });

  const createMutation = useMutation({
    mutationFn: createIssue,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: issueQueryKeys.my }),
        queryClient.invalidateQueries({ queryKey: issueQueryKeys.assigned }),
      ]);
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
      setTarget("higher_ups");
      setAssignedTo("");
      toast({
        title: "Issue created",
        description: `${result.issues.length} owner${result.issues.length === 1 ? "" : "s"} assigned.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Issue rejected",
        description: error instanceof Error ? error.message : "Could not create issue.",
        variant: "destructive",
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ issueId, status }: { issueId: string; status: IssueStatus }) => updateIssueStatus(issueId, status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: issueQueryKeys.my }),
        queryClient.invalidateQueries({ queryKey: issueQueryKeys.assigned }),
      ]);
      toast({ title: "Issue status updated" });
    },
    onError: (error) => {
      toast({
        title: "Status update failed",
        description: error instanceof Error ? error.message : "Could not update issue status.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (target === "specific_user" && !assignedTo) {
      toast({
        title: "Owner required",
        description: "Choose a specific user before creating the issue.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      title,
      description,
      priority,
      target,
      assigned_to: target === "specific_user" ? assignedTo : undefined,
    });
  };

  const handleAdvance = (issue: Issue) => {
    const nextStatus = nextIssueStatus(issue.status);
    if (!nextStatus) {
      return;
    }

    statusMutation.mutate({ issueId: issue.id, status: nextStatus });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Issues</h1>
          <p className="text-sm text-muted-foreground">Create, assign, and track controlled issue reports.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void myIssuesQuery.refetch();
            void assignedIssuesQuery.refetch();
          }}
          disabled={myIssuesQuery.isFetching || assignedIssuesQuery.isFetching}
        >
          <RefreshCw
            className={cn(
              "h-4 w-4 mr-2",
              (myIssuesQuery.isFetching || assignedIssuesQuery.isFetching) && "animate-spin",
            )}
          />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Create Issue</h2>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="issue-title" className="text-xs">Title</Label>
                <Input
                  id="issue-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  maxLength={160}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Priority</Label>
                <Select value={priority} onValueChange={(value) => setPriority(value as IssuePriority)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorities.map((item) => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="issue-description" className="text-xs">Description</Label>
              <Textarea
                id="issue-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
                className="min-h-24"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">Target</Label>
                <Select
                  value={target}
                  onValueChange={(value) => {
                    setTarget(value as IssueTarget);
                    setAssignedTo("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="higher_ups">Higher-ups</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="specific_user">Specific User</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Specific User</Label>
                <Select
                  value={assignedTo || "__none__"}
                  onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}
                  disabled={target !== "specific_user" || usersQuery.isLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={usersQuery.isLoading ? "Loading users..." : "Select user"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select user</SelectItem>
                    {usersQuery.data?.map((targetUser) => (
                      <SelectItem key={targetUser.employee_id} value={targetUser.employee_id}>
                        {targetUser.name} · {targetUser.employee_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" disabled={createMutation.isPending}>
                <Send className="h-4 w-4 mr-2" />
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Tabs defaultValue="created">
        <TabsList>
          <TabsTrigger value="created">Created</TabsTrigger>
          <TabsTrigger value="assigned">Assigned</TabsTrigger>
        </TabsList>
        <TabsContent value="created" className="mt-4">
          <IssueList
            issues={myIssuesQuery.data}
            loading={myIssuesQuery.isLoading}
            onAdvance={handleAdvance}
            advancing={statusMutation.isPending}
            currentUserId={user?.employee_id}
            isAdmin={isAdmin}
          />
        </TabsContent>
        <TabsContent value="assigned" className="mt-4">
          <IssueList
            issues={assignedIssuesQuery.data}
            loading={assignedIssuesQuery.isLoading}
            onAdvance={handleAdvance}
            advancing={statusMutation.isPending}
            currentUserId={user?.employee_id}
            isAdmin={isAdmin}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
