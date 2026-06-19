import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Loader2 } from "lucide-react";
import { createTask, fetchTaskAssignmentReferenceData } from "@/api/taskApi";
import { fetchDesignFixtures, fetchProjectDashboardSummary } from "@/api/designApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { toast } from "@/hooks/use-toast";
import { formatAssigneeOption } from "@/lib/employeeDisplay";
import { formatProjectNumber } from "@/lib/projectDisplay";
import { taskAssignmentQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import type { AdditionalDesignTaskKind, DesignTeam, Priority } from "@/types";

export const ADDITIONAL_DESIGN_TASK_KINDS: AdditionalDesignTaskKind[] = [
  "Drafting",
  "Print & Drafting Checking",
  "BOM Checking",
  "Drawing Correction",
  "AutoCAD PDF",
  "IGES Data",
  "CMM Data",
  "Line Layout",
  "Mimic Display",
  "Wear-Out Data",
];

function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function AdditionalDesignTaskAssignment() {
  const { access, user } = useAuth();
  const queryClient = useQueryClient();
  const [taskKind, setTaskKind] = useState<AdditionalDesignTaskKind>("Drafting");
  const [designTeam, setDesignTeam] = useState<DesignTeam>("3D");
  const [projectId, setProjectId] = useState("");
  const [fixtureId, setFixtureId] = useState("__project__");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [priority, setPriority] = useState<Priority>("medium");
  const [notes, setNotes] = useState("");

  const canAssign = access.canAssignTasks && access.canCreateTasks;
  const referenceQuery = useQuery({
    queryKey: [...taskAssignmentQueryKeys.all, "reference-data", "additional-design"],
    queryFn: fetchTaskAssignmentReferenceData,
    enabled: canAssign,
  });
  const projectsQuery = useQuery({
    queryKey: ["additional-design", "projects", user?.department_id || "all"],
    queryFn: () => fetchProjectDashboardSummary(user?.department_id || undefined),
    enabled: canAssign,
  });

  const projects = useMemo(() => (
    (projectsQuery.data ?? []).filter((project) => (
      project.project_status === "active"
      && (project.department_id?.toLowerCase() === "design" || project.department_name?.toLowerCase() === "design")
    ))
  ), [projectsQuery.data]);
  const selectedProject = projects.find((project) => project.project_id === projectId) || null;

  const fixturesQuery = useQuery({
    queryKey: ["additional-design", "fixtures", projectId],
    queryFn: () => fetchDesignFixtures(projectId, selectedProject?.department_id, { activeOnly: true }),
    enabled: canAssign && Boolean(projectId && selectedProject),
  });

  const assignees = useMemo(() => (
    (referenceQuery.data?.assignable_users ?? []).filter((candidate) => (
      candidate.department_id === selectedProject?.department_id
      && candidate.subdivision?.subdivision_name?.trim().toUpperCase() === designTeam
    ))
  ), [designTeam, referenceQuery.data?.assignable_users, selectedProject?.department_id]);

  const createMutation = useMutation({
    mutationFn: () => createTask({
      task_type: "additional_design",
      description: notes.trim(),
      assigned_to: assigneeId,
      department_id: selectedProject?.department_id,
      priority,
      deadline: new Date(dueDate).toISOString(),
      approval_required: true,
      proof_required: true,
      project_id: projectId,
      fixture_id: fixtureId === "__project__" ? null : fixtureId,
      additional_task_kind: taskKind,
      design_team: designTeam,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: taskAssignmentQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["additional-design"] }),
      ]);
      setAssigneeId("");
      setNotes("");
      toast({ title: "Additional task assigned", description: `${taskKind} was added to the ${designTeam} queue.` });
    },
    onError: (error) => {
      toast({
        title: "Could not assign task",
        description: error instanceof Error ? error.message : "Task assignment failed.",
        variant: "destructive",
      });
    },
  });

  if (!canAssign) {
    return null;
  }

  const formReady = Boolean(projectId && assigneeId && dueDate && selectedProject);

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="space-y-1 p-4 pb-3">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Assign Additional Design Task</h2>
        </div>
        <p className="text-sm text-muted-foreground">Assign independent 2D or 3D work without changing the fixture workflow stage.</p>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Task</Label>
            <Select value={taskKind} onValueChange={(value) => setTaskKind(value as AdditionalDesignTaskKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ADDITIONAL_DESIGN_TASK_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{kind}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId || "__none__"} onValueChange={(value) => {
              setProjectId(value === "__none__" ? "" : value);
              setFixtureId("__project__");
              setAssigneeId("");
            }}>
              <SelectTrigger><SelectValue placeholder={projectsQuery.isLoading ? "Loading projects..." : "Select project"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select project</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.project_id} value={project.project_id}>
                    {formatProjectNumber(project)} — {project.project_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Fixture</Label>
            <Select value={fixtureId} onValueChange={setFixtureId} disabled={!projectId || fixturesQuery.isLoading}>
              <SelectTrigger><SelectValue placeholder="Select fixture" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__project__">Entire project</SelectItem>
                {(fixturesQuery.data ?? []).map((fixture) => (
                  <SelectItem key={fixture.fixture_id} value={fixture.fixture_id}>
                    {fixture.fixture_no} — {fixture.part_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Team</Label>
            <Select value={designTeam} onValueChange={(value) => {
              setDesignTeam(value as DesignTeam);
              setAssigneeId("");
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2D">2D</SelectItem>
                <SelectItem value="3D">3D</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Assignee</Label>
            <Select value={assigneeId || "__none__"} onValueChange={(value) => setAssigneeId(value === "__none__" ? "" : value)} disabled={!selectedProject}>
              <SelectTrigger><SelectValue placeholder="Select assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select assignee</SelectItem>
                {assignees.map((candidate) => (
                  <SelectItem key={candidate.employee_id} value={candidate.employee_id}>{formatAssigneeOption(candidate)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProject && assignees.length === 0 ? <p className="text-xs text-amber-700">No accessible {designTeam} team members found.</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input type="datetime-local" value={dueDate} min={new Date().toISOString().slice(0, 16)} onChange={(event) => setDueDate(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label>Instructions</Label>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional execution notes or deliverable requirements" rows={2} />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => createMutation.mutate()} disabled={!formReady || createMutation.isPending}>
            {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarPlus className="mr-2 h-4 w-4" />}
            Assign Task
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
