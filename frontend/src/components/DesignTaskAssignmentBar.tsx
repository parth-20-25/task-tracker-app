import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Sparkles, X } from "lucide-react";
import {
  createDesignTask,
  fetchDepartmentWorkflowPreview,
  fetchDesignFixtures,
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
  const [fixtureId, setFixtureId] = useState("");
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

  const fixturesQuery = useQuery({
    queryKey: ["designFixtures", scopeId || "unselected"],
    queryFn: () => fetchDesignFixtures(scopeId),
    enabled: Boolean(scopeId),
  });

  const assignableUsers = assignableUsersQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const scopes = scopesQuery.data ?? [];
  const fixtures = fixturesQuery.data ?? [];

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
  const selectedFixture = fixtures.find((fixture) => fixture.id === fixtureId);

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
      setFixtureId("");
      setDescription("");
      setAssignedTo("");
      setPriority("P2");
      setDeadline("");
      setSearchQuery("");
      setOpen(false);

      toast({
        title: "Design task assigned",
        description: "The task has been created with the selected project, scope, and fixture.",
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
    setFixtureId("");
  };

  const handleScopeChange = (value: string) => {
    setScopeId(value);
    setFixtureId("");
  };

  const handleSubmit = () => {
    if (!projectId || !scopeId || !fixtureId || !assignedTo || !deadline) {
      return;
    }

    createTaskMutation.mutate({
      project_id: projectId,
      scope_id: scopeId,
      fixture_id: fixtureId,
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

  const fixturePlaceholder = !scopeId
    ? "Select scope first"
    : fixturesQuery.isLoading
      ? "Loading fixtures..."
      : fixtures.length > 0
        ? "Select fixture"
        : "No fixtures available";

  return (
    <Card className="animate-fade-in border-primary/20 bg-background/50 backdrop-blur-sm shadow-md transition-all">
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2 border-b">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-primary">
            <Sparkles className="h-4 w-4" />
            Design Task Assignment
          </h3>
          <p className="mt-1 text-xs text-muted-foreground font-medium">
            Deploy deterministic tasks based on validated fixture ingestion.
          </p>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8 rounded-full border-primary/20 hover:bg-primary/10" onClick={() => setOpen((current) => !current)}>
          {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 p-4 pt-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Project *</Label>
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
              <Label className="text-xs font-semibold">Scope *</Label>
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
              <Label className="text-xs font-semibold">Fixture *</Label>
              <Select value={fixtureId} onValueChange={setFixtureId}>
                <SelectTrigger className="h-9 text-sm border-primary/40 focus:border-primary" disabled={!scopeId || fixturesQuery.isLoading || fixtures.length === 0}>
                  <SelectValue placeholder={fixturePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {fixtures.map((fixture) => (
                    <SelectItem key={fixture.id} value={fixture.id}>
                      {fixture.fixture_no} - {fixture.part_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Priority *</Label>
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

          {(selectedProject || selectedScope || selectedFixture) && (
            <div className="grid gap-3 rounded-xl border bg-gradient-to-r from-muted/50 to-muted/20 p-4 text-xs md:grid-cols-4 shadow-inner">
              <div className="md:col-span-1">
                <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">Project Selection</p>
                <p className="mt-1 font-medium text-foreground truncate">
                  {selectedProject ? selectedProject.project_no : "-"}
                </p>
                <p className="text-muted-foreground truncate">{selectedScope ? selectedScope.scope_name : "-"}</p>
              </div>
              <div className="md:col-span-3 border-l pl-4">
                <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold mb-2">Fixture Details (Read-only)</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground">PART NAME</div>
                    <div className="font-semibold">{selectedFixture?.part_name || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">OP.NO</div>
                    <div className="font-semibold">{selectedFixture?.op_no || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">TYPE</div>
                    <div className="font-semibold">{selectedFixture?.fixture_type || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">QTY</div>
                    <div className="font-semibold text-primary">{selectedFixture?.qty || "-"}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!projectsQuery.isLoading && projects.length === 0 && (
            <div className="rounded-xl border-2 border-dashed p-4 text-sm text-center text-muted-foreground bg-muted/10">
              Upload project data first using the Excel ingestion system.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Deadline *</Label>
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                className="h-9 text-sm"
              />
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Workflow Stage (Auto)</Label>
              <Input
                readOnly
                disabled
                value={workflowPreviewQuery.isLoading ? "Loading..." : workflowPreviewQuery.data?.first_stage_name || "Not configured"}
                className="h-9 text-sm bg-muted/50 cursor-not-allowed text-muted-foreground"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Assign To *</Label>
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
                        className="w-full rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-primary/10"
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
            <Label className="text-xs font-semibold">Task Description (Optional)</Label>
            <Textarea
              placeholder="Add execution notes for the design team..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          <div className="flex justify-end pt-2 border-t mt-4">
            <Button
              onClick={handleSubmit}
              className="h-10 px-6 text-sm font-semibold shadow-sm hover:translate-y-[-1px] transition-all"
              disabled={
                !projectId
                || !scopeId
                || !fixtureId
                || !assignedTo
                || !deadline
                || createTaskMutation.isPending
              }
            >
              <Plus className="mr-2 h-4 w-4 text-white" />
              {createTaskMutation.isPending ? "Deploying..." : "Deploy Design Task"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
