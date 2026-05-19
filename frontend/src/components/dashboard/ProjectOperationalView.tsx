import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Layers, FolderKanban, UserCircle2, AlertCircle } from "lucide-react";
import { fetchDesignFixtures, fetchDesignProjects } from "@/api/designApi";
import { DesignFixtureOption, DesignProjectOption, User } from "@/types";
import { formatDesignProjectLabel } from "@/lib/projectDisplay";
import {
  formatStageRevisionCode,
  getWorkflowStageDisplayLabel,
  getWorkflowStatusLabel,
} from "@/lib/workflowStageDisplay";
import { cn } from "@/lib/utils";

interface ProjectOperationalViewProps {
  user: User | null;
}

interface FixtureProgressInfo {
  percent: number | null;
  hint: string;
}

function computeFixtureProgress(fixture: DesignFixtureOption): FixtureProgressInfo {
  if (fixture.is_workflow_complete) {
    return { percent: 100, hint: "Workflow complete" };
  }

  const stageOrder = fixture.workflow_stage_order;
  if (stageOrder === null || stageOrder === undefined) {
    return { percent: null, hint: "Not started" };
  }

  const status = String(fixture.workflow_status || "").toUpperCase();
  const baseFromOrder = Math.max(0, Number(stageOrder) - 1);
  let increment = 0;

  if (status === "IN_PROGRESS") {
    increment = 0.5;
  } else if (status === "COMPLETED" || status === "APPROVED") {
    increment = 1;
  }

  const normalized = Math.min(100, Math.max(0, (baseFromOrder + increment) * 20));
  return { percent: normalized, hint: `Stage ${stageOrder}` };
}

function getApprovalStatus(fixture: DesignFixtureOption): { label: string; tone: "neutral" | "warn" | "good" | "bad" } | null {
  const status = String(fixture.workflow_status || "").toUpperCase();

  if (status === "COMPLETED") {
    return { label: "Awaiting approval", tone: "warn" };
  }

  if (status === "APPROVED") {
    return { label: "Approved", tone: "good" };
  }

  if (status === "REJECTED") {
    return { label: "Rejected", tone: "bad" };
  }

  return null;
}

function workflowStatusTone(status: string | null | undefined): "neutral" | "info" | "warn" | "good" | "bad" {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "IN_PROGRESS") return "info";
  if (normalized === "COMPLETED") return "warn";
  if (normalized === "APPROVED") return "good";
  if (normalized === "REJECTED") return "bad";
  return "neutral";
}

const PROJECT_LIST_LIMIT = 200;

export function ProjectOperationalView({ user }: ProjectOperationalViewProps) {
  const employeeId = user?.employee_id || "anonymous";
  const departmentId = user?.department_id || "";

  const projectsQuery = useQuery<DesignProjectOption[]>({
    queryKey: ["dashboard", "project-operational", "projects", employeeId, departmentId],
    queryFn: () => fetchDesignProjects(),
    enabled: Boolean(employeeId !== "anonymous"),
    staleTime: 60_000,
  });

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const limitedProjects = useMemo(() => projects.slice(0, PROJECT_LIST_LIMIT), [projects]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  useEffect(() => {
    if (!limitedProjects.length) {
      if (selectedProjectId !== "") {
        setSelectedProjectId("");
      }
      return;
    }

    const hasSelection = limitedProjects.some((project) => project.project_id === selectedProjectId);
    if (!hasSelection) {
      setSelectedProjectId(limitedProjects[0].project_id);
    }
  }, [limitedProjects, selectedProjectId]);

  const fixturesQuery = useQuery<DesignFixtureOption[]>({
    queryKey: ["dashboard", "project-operational", "fixtures", selectedProjectId],
    queryFn: () => fetchDesignFixtures(selectedProjectId),
    enabled: Boolean(selectedProjectId),
    staleTime: 30_000,
  });

  const fixtures = fixturesQuery.data ?? [];
  const selectedProject = limitedProjects.find((project) => project.project_id === selectedProjectId) || null;

  return (
    <section className="space-y-3" aria-label="Project Operational View">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Project Operational View</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Only projects visible to you appear in this list.
        </p>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="space-y-3 p-4 pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="project-operational-select"
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Project
              </label>
              <div className="mt-1">
                <Select
                  value={selectedProjectId || undefined}
                  onValueChange={(value) => setSelectedProjectId(value === "__none__" ? "" : value)}
                  disabled={projectsQuery.isLoading || limitedProjects.length === 0}
                >
                  <SelectTrigger
                    id="project-operational-select"
                    data-testid="project-operational-select"
                    className="h-9 text-sm"
                  >
                    <SelectValue
                      placeholder={projectsQuery.isLoading ? "Loading projects..." : "Select project"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {limitedProjects.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No projects available
                      </SelectItem>
                    ) : (
                      limitedProjects.map((project) => (
                        <SelectItem key={project.project_id} value={project.project_id}>
                          {formatDesignProjectLabel(project)}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {selectedProject ? (
              <div className="text-right text-xs text-muted-foreground">
                <p className="font-semibold text-sm text-foreground">
                  {selectedProject.project_code || selectedProject.project_id}
                </p>
                <p className="truncate">{selectedProject.company_name || "Customer unknown"}</p>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {projectsQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Unable to load your projects.
            </div>
          ) : null}

          {!projectsQuery.isError && limitedProjects.length === 0 && !projectsQuery.isLoading ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              You don't have any projects visible to your role yet.
            </div>
          ) : null}

          {selectedProjectId ? (
            <FixtureOperationalList
              fixtures={fixtures}
              isLoading={fixturesQuery.isLoading}
              isError={fixturesQuery.isError}
            />
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

interface FixtureOperationalListProps {
  fixtures: DesignFixtureOption[];
  isLoading: boolean;
  isError: boolean;
}

function FixtureOperationalList({ fixtures, isLoading, isError }: FixtureOperationalListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        Unable to load fixtures for this project.
      </div>
    );
  }

  if (!fixtures.length) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No fixtures under this project.
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="project-fixtures-list">
      {fixtures.map((fixture) => (
        <FixtureRow key={fixture.fixture_id} fixture={fixture} />
      ))}
    </ul>
  );
}

function toneClassFromTone(
  tone: "neutral" | "info" | "warn" | "good" | "bad",
): string {
  switch (tone) {
    case "info":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "warn":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "good":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "bad":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function FixtureRow({ fixture }: { fixture: DesignFixtureOption }) {
  const stageLabel = getWorkflowStageDisplayLabel(fixture.workflow_stage);
  const revisionCode = fixture.workflow_revision_code
    || formatStageRevisionCode(fixture.workflow_stage, fixture.workflow_stage_version ?? 0);
  const statusLabel = getWorkflowStatusLabel(fixture.workflow_status);
  const statusTone = workflowStatusTone(fixture.workflow_status);
  const approval = getApprovalStatus(fixture);
  const progress = computeFixtureProgress(fixture);
  const assigneeName = fixture.workflow_assigned_to_name
    || fixture.workflow_assigned_to
    || null;
  const isComplete = fixture.is_workflow_complete === true;

  return (
    <li
      data-testid="project-fixture-row"
      className="rounded-md border border-slate-200 bg-card p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{fixture.fixture_no}</p>
          <p className="text-xs text-muted-foreground truncate">
            OP {fixture.op_no || "—"} · {fixture.part_name || "Unnamed part"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {stageLabel || revisionCode ? (
            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-primary">
              <Layers className="h-3.5 w-3.5" />
              {stageLabel ? (
                <span className="font-semibold uppercase tracking-wide">
                  {stageLabel}
                </span>
              ) : null}
              {revisionCode ? (
                <>
                  <span aria-hidden="true" className="text-primary/40">—</span>
                  <span className="font-semibold uppercase tracking-wide">{revisionCode}</span>
                </>
              ) : null}
            </div>
          ) : null}
          {statusLabel ? (
            <Badge
              variant="outline"
              className={cn("uppercase tracking-wide", toneClassFromTone(statusTone))}
            >
              {statusLabel}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
        <div>
          <p className="text-muted-foreground">Assignee</p>
          <div className="mt-1 flex items-center gap-1 font-medium">
            <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{assigneeName || (isComplete ? "Complete" : "Unassigned")}</span>
          </div>
        </div>
        <div>
          <p className="text-muted-foreground">Progress</p>
          <div className="mt-1">
            {progress.percent === null ? (
              <p className="text-xs text-muted-foreground">{progress.hint}</p>
            ) : (
              <div className="flex items-center gap-2">
                <Progress value={progress.percent} className="h-1.5 flex-1" />
                <span className="font-semibold text-foreground tabular-nums">
                  {Math.round(progress.percent)}%
                </span>
              </div>
            )}
          </div>
        </div>
        <div>
          <p className="text-muted-foreground">Approval</p>
          <div className="mt-1">
            {approval ? (
              <Badge variant="outline" className={cn("uppercase tracking-wide", toneClassFromTone(approval.tone))}>
                {approval.label}
              </Badge>
            ) : (
              <p className="text-xs text-muted-foreground">—</p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
