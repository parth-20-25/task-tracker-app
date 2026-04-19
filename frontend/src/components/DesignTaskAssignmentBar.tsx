import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Sparkles, X } from "lucide-react";
import {
  createDesignTask,
  fetchDepartmentWorkflowPreview,
  fetchDesignInstances,
  fetchDesignProjects,
  fetchDesignScopes,
} from "@/api/designApi";
import { useAssignableUsersQuery } from "@/hooks/queries/useAssignableUsersQuery";
import { toast } from "@/hooks/use-toast";
import { adminQueryKeys, analyticsQueryKeys, notificationQueryKeys, projectQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const priorityOptions = [
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" },
  { value: "P3", label: "P3" },
] as const;

const priorityValueMap = {
  P1: "critical",
  P2: "high",
  P3: "medium",
} as const;

type DesignPriority = keyof typeof priorityValueMap;

export function DesignTaskAssignmentBar() {
  const queryClient = useQueryClient();
  const assignableUsersQuery = useAssignableUsersQuery();
  const projectsQuery = useQuery({
    queryKey: projectQueryKeys.designProjects,
    queryFn: fetchDesignProjects,
  });

  const workflowPreviewQuery = useQuery({
    queryKey: ["design", "workflow-preview"],
    queryFn: fetchDepartmentWorkflowPreview,
  });

  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState<DesignPriority>("P2");
  const [deadline, setDeadline] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const scopesQuery = useQuery({
    queryKey: projectQueryKeys.designScopes(projectId || "unselected"),
    queryFn: () => fetchDesignScopes(projectId),
    enabled: Boolean(projectId),
  });

  const instancesQuery = useQuery({
    queryKey: projectQueryKeys.designInstances(scopeId || "unselected"),
    queryFn: () => fetchDesignInstances(scopeId),
    enabled: Boolean(scopeId),
  });

  const assignableUsers = assignableUsersQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const scopes = scopesQuery.data ?? [];
  const instances = instancesQuery.data ?? [];

  const filteredUsers = useMemo(
    () =>
      assignableUsers.filter((user) =>
        user.name.toLowerCase().includes(searchQuery.toLowerCase())
        || user.employee_id.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [assignableUsers, searchQuery],
  );

  const selectedUser = assignableUsers.find((user) => user.employee_id === assignedTo);
  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedScope = scopes.find((scope) => scope.id === scopeId);
  const selectedInstance = instances.find((instance) => instance.id === instanceId);

  const createTaskMutation = useMutation({
    mutationFn: createDesignTask,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogs }),
        queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all }),
      ]);

      setProjectId("");
      setScopeId("");
      setInstanceId("");
      setDescription("");
      setAssignedTo("");
      setPriority("P2");
      setDeadline("");
      setSearchQuery("");
      setOpen(false);

      toast({
        title: "Design task assigned",
        description: "The task has been created with the selected project, scope, and instance.",
      });
    },
    onError: (error) => {
      toast({
        title: "Task not assigned",
        description: error instanceof Error ? error.message : "Failed to assign design task",
        variant: "destructive",
      });
    },
  });

  const handleProjectChange = (value: string) => {
    setProjectId(value);
    setScopeId("");
    setInstanceId("");
  };

  const handleScopeChange = (value: string) => {
    setScopeId(value);
    setInstanceId("");
  };

  const handleSubmit = () => {
    if (!projectId || !scopeId || !instanceId || !description || !assignedTo || !deadline) {
      return;
    }

    createTaskMutation.mutate({
      project_id: projectId,
      scope_id: scopeId,
      instance_id: instanceId,
      description,
      assigned_to: assignedTo,
      assignee_ids: [assignedTo],
      priority: priorityValueMap[priority],
      deadline: new Date(deadline).toISOString(),
    });
  };

  const projectPlaceholder = projectsQuery.isLoading
    ? "Loading projects..."
    : projects.length > 0
      ? "Select project"
      : "No projects available";

  const scopePlaceholder = !projectId
    ? "Select project first"
    : scopesQuery.isLoading
      ? "Loading scopes..."
      : scopes.length > 0
        ? "Select scope"
        : "No scopes available";

  const instancePlaceholder = !scopeId
    ? "Select scope first"
    : instancesQuery.isLoading
      ? "Loading instances..."
      : instances.length > 0
        ? "Select instance"
        : "No instances available";

  return (
    <Card className="animate-fade-in border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Design Task Assignment
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Department-scoped project, scope, and instance selection for design assignments.
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen((current) => !current)}>
          {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 p-4 pt-2">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Project *</Label>
              <Select value={projectId} onValueChange={handleProjectChange}>
                <SelectTrigger className="h-9 text-sm" disabled={projectsQuery.isLoading || projects.length === 0}>
                  <SelectValue placeholder={projectPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.project_no} · {project.project_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Scope *</Label>
              <Select value={scopeId} onValueChange={handleScopeChange}>
                <SelectTrigger className="h-9 text-sm" disabled={!projectId || scopesQuery.isLoading || scopes.length === 0}>
                  <SelectValue placeholder={scopePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {scopes.map((scope) => (
                    <SelectItem key={scope.id} value={scope.id}>
                      {scope.scope_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Instance *</Label>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger className="h-9 text-sm" disabled={!scopeId || instancesQuery.isLoading || instances.length === 0}>
                  <SelectValue placeholder={instancePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.id}>
                      {instance.instance_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Priority *</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as DesignPriority)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(selectedProject || selectedScope || selectedInstance) && (
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-xs md:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Project</p>
                <p className="mt-1 font-medium text-foreground">
                  {selectedProject ? `${selectedProject.project_no} · ${selectedProject.project_name}` : "Not selected"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Scope</p>
                <p className="mt-1 font-medium text-foreground">{selectedScope?.scope_name || "Not selected"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Instance</p>
                <p className="mt-1 font-medium text-foreground">{selectedInstance?.instance_code || "Not selected"}</p>
              </div>
            </div>
          )}

          {!projectsQuery.isLoading && projects.length === 0 && (
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Upload project data first. Only project records from your department are exposed here.
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Deadline *</Label>
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                className="h-9 text-sm"
              />
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs">Workflow Stage (Auto)</Label>
              <Input
                readOnly
                disabled
                value={workflowPreviewQuery.isLoading ? "Loading..." : workflowPreviewQuery.data?.first_stage_name || "Not configured"}
                className="h-9 text-sm bg-muted/50 cursor-not-allowed"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Assign To *</Label>
              <Popover open={showSearch} onOpenChange={setShowSearch}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-9 w-full justify-start text-sm font-normal">
                    <Search className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    {selectedUser ? `${selectedUser.name} (${selectedUser.employee_id})` : "Search employee..."}
                  </Button>
                </PopoverTrigger>

                <PopoverContent className="w-72 p-2" align="start">
                  <Input
                    placeholder="Search by name or ID..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="mb-2 h-8 text-sm"
                  />

                  <div className="max-h-40 space-y-0.5 overflow-y-auto">
                    {filteredUsers.map((user) => (
                      <button
                        key={user.employee_id}
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                        onClick={() => {
                          setAssignedTo(user.employee_id);
                          setShowSearch(false);
                          setSearchQuery("");
                        }}
                      >
                        <span className="font-medium">{user.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{user.employee_id}</span>
                      </button>
                    ))}

                    {filteredUsers.length === 0 && (
                      <p className="py-2 text-center text-xs text-muted-foreground">No matches</p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Task Description *</Label>
            <Textarea
              placeholder="Add execution notes for the design team..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              className="h-9 text-sm"
              disabled={
                !projectId
                || !scopeId
                || !instanceId
                || !description
                || !assignedTo
                || !deadline
                || createTaskMutation.isPending
              }
            >
              <Plus className="mr-1 h-4 w-4" />
              {createTaskMutation.isPending ? "Assigning..." : "Assign Design Task"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
