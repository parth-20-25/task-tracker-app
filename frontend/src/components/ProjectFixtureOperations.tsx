import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  CalendarIcon,
  CheckSquare,
  ChevronDown,
  Factory,
  Image as ImageIcon,
  Loader2,
  Rocket,
  User,
  UserCheck,
  UserX,
  XCircle,
} from "lucide-react";
import {
  createDesignTask,
  fetchFixtureFullProgress,
  manipulateFixtureStage,
  reopenFixtureStage,
  releaseFixtureWorkflow,
  validateFixtureAssignment,
  type FixtureCurrentStage,
  type FixtureFullProgress,
  type FixtureRevisionType,
} from "@/api/designApi";
import { cancelTask as cancelTaskRequest, fetchTaskAssignmentUsers, fetchVerificationTasks, transferTask, updateTask } from "@/api/taskApi";
import { fetchFixtureReleasePackage, type FixtureReleasePackageResponse } from "@/api/releaseDeliverablesApi";
import { fetchProjectOutsourceAssignments } from "@/api/outsourceAssignmentsApi";
import { BulkOutsourceDialog } from "@/components/BulkOutsourceDialog";
import { FixtureOutsourceAssignmentsTable } from "@/components/FixtureOutsourceAssignmentsTable";
import { ReleaseDeliverablesPanel } from "@/components/ReleaseDeliverablesPanel";
import { SafeImage } from "@/components/SafeImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/useAuth";
import { useTasks } from "@/contexts/useTasks";
import { useAssignableUsersQuery } from "@/hooks/queries/useAssignableUsersQuery";
import { toast } from "@/hooks/use-toast";
import { adminQueryKeys, analyticsQueryKeys, batchQueryKeys, projectQueryKeys, taskAssignmentQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { formatAssigneeOption, formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { cn } from "@/lib/utils";
import { hasAnyUserPermission, hasUserPermission, PERMISSIONS as UI_PERMISSIONS } from "@/lib/permissions";
import { resolveImageUrl } from "@/lib/imageUrl";
import {
  compactWorkflowCode,
  getFixtureCurrentRevisionLabel,
  getFixtureWorkflowCode,
  isFixtureActiveOutsourcedSection,
  isFixtureCurrentStageOutsourced,
  normalizeStageKey,
} from "@/lib/outsourceWorkflowDisplay";
import type { DesignFixtureOption, Priority, Task, User as AppUser } from "@/types";

const OPEN_TASK_STATUSES = new Set(["assigned", "in_progress", "on_hold", "under_review", "rework"]);
const ASSIGNMENT_BLOCKED_STATES = new Set(["VERIFICATION", "REWORK", "IN_PROGRESS", "ASSIGNED", "WORKFLOW_COMPLETE"]);

type FixtureOperationalState = "VERIFICATION" | "REWORK" | "UNASSIGNED" | "IN_PROGRESS" | "ASSIGNED" | "WORKFLOW_COMPLETE";

interface FixtureOperationalResolution {
  state: FixtureOperationalState;
  assignable: boolean;
  activeTask: Task | null;
  activeAssignee: string | null;
  activeAssigneeName: string | null;
  hasActiveTask: boolean;
  hasWorkflowOccupancy: boolean;
  workflowLocked: boolean;
  reason: string | null;
}

const priorityOptions: Array<{ value: Priority; label: string }> = [
  { value: "critical", label: "P1 - Critical" },
  { value: "high", label: "P2 - High" },
  { value: "medium", label: "P3 - Medium" },
  { value: "low", label: "P4 - Low" },
];

const revisionReasonOptions: Array<{ value: FixtureRevisionType; label: string }> = [
  { value: "CUSTOMER_CHANGE", label: "Customer Change" },
  { value: "CUSTOMER_TRIAL_CHANGE", label: "Customer Trial Change" },
  { value: "CUSTOMER_REVISION", label: "Customer Revision" },
  { value: "INTERNAL_DESIGN_CHANGE", label: "Internal Design Change" },
  { value: "MANUFACTURING_ISSUE", label: "Manufacturing Issue" },
  { value: "QUALITY_CORRECTION", label: "Quality Correction" },
  { value: "COST_OPTIMIZATION", label: "Cost Optimization" },
  { value: "APPROVAL_REJECTION", label: "Approval Rejection" },
  { value: "PROCUREMENT_CONSTRAINT", label: "Procurement Constraint" },
  { value: "MANUAL_OVERRIDE", label: "Manual Override" },
  { value: "OTHER", label: "Other" },
];

function isReleaseStageName(value: string | null | undefined) {
  const normalized = normalizeStageKey(value);
  return normalized === "release" || normalized === "released";
}

function getStageWorkflowCode(stage: FixtureFullProgress["stages"][number] | null | undefined) {
  return compactWorkflowCode(stage?.revision_code)
    || (stage ? `Stage${stage.stage_order}` : "Workflow");
}

function getCurrentProgressStage(progress: FixtureFullProgress | null | undefined) {
  return progress?.stages?.find((stage) => stage.status !== "APPROVED") || null;
}

function getAssignableWorkflowOptions(progress: FixtureFullProgress | null | undefined) {
  if (!progress?.stages) {
    return [];
  }

  const sortedStages = [...progress.stages]
    .sort((left, right) => Number(left.stage_order) - Number(right.stage_order));

  if (sortedStages.some((stage) => isReleaseStageName(stage.stage_name))) {
    return sortedStages;
  }

  const lastStageOrder = sortedStages.reduce(
    (max, stage) => Math.max(max, Number(stage.stage_order) || 0),
    0,
  );

  return [
    ...sortedStages,
    {
      stage_name: "Release",
      stage_label: "Release",
      stage_version: 0,
      revision_code: "REL 00",
      stage_order: lastStageOrder + 1,
      status: "PENDING" as const,
      assigned_to: null,
      assigned_at: null,
      started_at: null,
      completed_at: null,
      duration_minutes: null,
      updated_at: new Date(0).toISOString(),
      contributions: [],
    },
  ];
}

function normalizeDeadlineToEndOfDayIso(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error("Deadline date is invalid");
  }

  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function formatDeadlineDate(dateValue: string) {
  if (!dateValue) {
    return "Deadline";
  }

  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) {
    return "Deadline";
  }

  return format(new Date(year, month - 1, day), "dd/MM/yyyy");
}

function fixtureStageStatusLabel(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case "IN_PROGRESS":
      return "In Progress";
    case "PENDING":
      return "Pending";
    case "APPROVED":
      return "Approved";
    case "VERIFICATION":
      return "Verification";
    case "REJECTED":
      return "Rejected";
    case "REWORK":
      return "Rework";
    case "ASSIGNED":
      return "Assigned";
    case "WORKFLOW_COMPLETE":
      return "Released";
    case "UNASSIGNED":
      return "Unassigned";
    default:
      return status || "Pending";
  }
}

function formatDisplayDate(value: string | null | undefined, fallback = "Not set") {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getFixtureReleaseDate(fixture: DesignFixtureOption) {
  return fixture.workflow_released_at || null;
}

function getFixtureReleasedBy(fixture: DesignFixtureOption) {
  if (!fixture.workflow_released_by && !fixture.workflow_released_by_name) {
    return "Not recorded";
  }

  return formatEmployeeDisplay(fixture.workflow_released_by || null, fixture.workflow_released_by_name);
}

function isTwoDStageName(value: string | null | undefined) {
  const normalized = normalizeStageKey(value);
  return normalized === "2d" || normalized === "2d_finish" || normalized === "two_d" || normalized === "two_d_finish";
}

function buildSelectedAssigneeIds(primaryAssigneeId: string, additionalAssigneeIds: string[], allowMultiple: boolean) {
  const primary = String(primaryAssigneeId || "").trim();
  if (!primary) {
    return [];
  }

  return [
    primary,
    ...(allowMultiple ? additionalAssigneeIds : []),
  ].filter(Boolean).filter((employeeId, index, values) => values.indexOf(employeeId) === index);
}

function formatSubmittedDate(value: string | null | undefined) {
  if (!value) {
    return "Not submitted";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not submitted";
  }

  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function normalizeTaskStage(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function getTaskScore(task: Task, fixture: DesignFixtureOption) {
  let score = 0;

  if (task.status === "under_review") {
    score += 100;
  } else if (OPEN_TASK_STATUSES.has(task.status)) {
    score += 80;
  } else if (task.status === "closed") {
    score += 20;
  }

  if (normalizeTaskStage(task.workflow_stage) === normalizeTaskStage(fixture.workflow_stage)) {
    score += 20;
  }

  return score;
}

function pickFixtureTask(fixture: DesignFixtureOption, tasks: Task[]) {
  const candidates = tasks
    .filter((task) => task.fixture_id === fixture.fixture_id)
    .sort((left, right) => {
      const scoreDelta = getTaskScore(right, fixture) - getTaskScore(left, fixture);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });

  return candidates[0] || null;
}

function getProofImage(task: Task | null) {
  const proofUrls = task?.proof_url ?? [];
  if (task?.latest_proof?.file_url) {
    return task.latest_proof.file_url;
  }
  return proofUrls.length > 0 ? proofUrls[proofUrls.length - 1] : null;
}

function getProofUploadedAt(task: Task | null) {
  return task?.latest_proof?.uploaded_at || null;
}

function getProofUploadedBy(task: Task | null) {
  return task?.latest_proof?.uploaded_by || task?.latest_proof?.uploaded_by_name
    ? formatEmployeeDisplay(task?.latest_proof?.uploaded_by || null, task?.latest_proof?.uploaded_by_name)
    : null;
}

function getAssigneeName(fixture: DesignFixtureOption, task: Task | null) {
  if (task?.assignee_names) {
    return task.assignee_names;
  }

  if (task?.assignee) {
    return formatEmployeeDisplay(task.assignee);
  }

  if (task?.assigned_to || fixture.workflow_assigned_to || fixture.workflow_assigned_to_name) {
    return formatEmployeeDisplay(task?.assigned_to || fixture.workflow_assigned_to || null, fixture.workflow_assigned_to_name);
  }

  return "Unassigned";
}

function normalizeOperationalState(value: string | null | undefined): FixtureOperationalState {
  const normalized = String(value || "UNASSIGNED").toUpperCase();
  if (
    normalized === "VERIFICATION"
    || normalized === "REWORK"
    || normalized === "IN_PROGRESS"
    || normalized === "ASSIGNED"
    || normalized === "WORKFLOW_COMPLETE"
  ) {
    return normalized;
  }

  return "UNASSIGNED";
}

function isActiveTask(task: Task | null) {
  return Boolean(task && OPEN_TASK_STATUSES.has(task.status));
}

function isTaskAssignedToCurrentUser(task: Task | null, employeeId: string | null | undefined) {
  if (!task || !employeeId) {
    return false;
  }

  return task.assigned_to === employeeId || task.assignee_ids?.includes(employeeId) === true;
}

function resolveFixtureOperationalState(fixture: DesignFixtureOption, task: Task | null): FixtureOperationalResolution {
  const activeTask = isActiveTask(task) ? task : null;
  const state = normalizeOperationalState(fixture.operational_state);
  const activeAssignee = activeTask?.assigned_to || fixture.workflow_assigned_to || null;
  const activeAssigneeName = activeTask?.assignee_names
    ? activeTask.assignee_names
    : activeTask?.assignee
    ? formatEmployeeDisplay(activeTask.assignee)
    : activeAssignee || fixture.workflow_assigned_to_name
      ? formatEmployeeDisplay(activeAssignee || null, fixture.workflow_assigned_to_name)
      : null;
  const workflowStatus = String(fixture.workflow_status || "").toUpperCase();
  const hasWorkflowOccupancy = Boolean(
    fixture.workflow_assigned_to
    || workflowStatus === "IN_PROGRESS"
    || workflowStatus === "SUBMITTED_FOR_VERIFICATION",
  );
  const workflowLocked = workflowStatus === "SUBMITTED_FOR_VERIFICATION"
    || (hasWorkflowOccupancy && !activeTask);
  let reason: string | null = null;

  if (state === "VERIFICATION") {
    reason = "Already under verification";
  } else if (state === "WORKFLOW_COMPLETE") {
    reason = "Workflow complete";
  } else if (state === "REWORK") {
    reason = "Rejected for rework";
  } else if (activeAssigneeName && ASSIGNMENT_BLOCKED_STATES.has(state)) {
    reason = `Already assigned to ${activeAssigneeName}`;
  } else if (workflowLocked) {
    reason = "Workflow locked";
  } else if (state !== "UNASSIGNED") {
    reason = fixtureStageStatusLabel(state);
  }

  return {
    state,
    assignable: state === "UNASSIGNED" && !activeTask && !hasWorkflowOccupancy && !workflowLocked,
    activeTask,
    activeAssignee,
    activeAssigneeName,
    hasActiveTask: Boolean(activeTask),
    hasWorkflowOccupancy,
    workflowLocked,
    reason,
  };
}

function getSubmittedValue(task: Task | null) {
  return task?.submitted_at || task?.completed_at || null;
}

function canCancelFixtureOperationalTask(
  task: Task | null,
  state: FixtureOperationalState,
  user: AppUser | null | undefined,
  access: ReturnType<typeof useAuth>["access"],
) {
  if (!task || task.approved_at || task.verification_status === "approved") {
    return false;
  }

  if (state !== "ASSIGNED" && state !== "IN_PROGRESS") {
    return false;
  }

  if (["cancelled", "closed", "under_review", "rework"].includes(task.status)) {
    return false;
  }

  const hasCancellationAccess = access.canAccessProjectFixtures
    || access.canAssignTasks
    || task.assigned_by === user?.employee_id;

  if (!hasCancellationAccess) {
    return false;
  }

  if (state === "ASSIGNED") {
    return task.status === "assigned" || task.status === "in_progress";
  }

  return task.status === "assigned" || task.status === "in_progress";
}

interface ProjectFixtureOperationsGridProps {
  fixtures: DesignFixtureOption[];
  projectId: string;
  departmentId?: string | null;
  readOnly?: boolean;
  projectLabel?: string;
}
type FixtureReleaseFilter = "ALL" | "WORKFLOW_ACTIVE" | "PENDING_DELIVERABLES" | "READY_FOR_RELEASE" | "RELEASED";

const FIXTURE_RELEASE_FILTERS: Array<{ value: FixtureReleaseFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "WORKFLOW_ACTIVE", label: "Workflow Active" },
  { value: "PENDING_DELIVERABLES", label: "Pending Deliverables" },
  { value: "READY_FOR_RELEASE", label: "Ready for Release" },
  { value: "RELEASED", label: "Released" },
];

function fixtureReleaseState(fixture: DesignFixtureOption): Exclude<FixtureReleaseFilter, "ALL"> {
  if (fixture.fixture_release_state) {
    return fixture.fixture_release_state as Exclude<FixtureReleaseFilter, "ALL">;
  }
  return fixture.workflow_released_at || fixture.is_workflow_complete
    ? "RELEASED"
    : "WORKFLOW_ACTIVE";
}

function applyReleasedFixtureState(fixture: DesignFixtureOption, releaseState: FixtureCurrentStage | undefined) {
  if (!releaseState?.is_complete) {
    return fixture;
  }

  return {
    ...fixture,
    is_workflow_complete: true,
    operational_state: "WORKFLOW_COMPLETE",
    workflow_status: releaseState.status || "APPROVED",
    workflow_stage: releaseState.stage,
    workflow_stage_label: releaseState.stage_label ?? "Released",
    workflow_stage_order: releaseState.stage_order,
    workflow_stage_version: releaseState.stage_version,
    workflow_assigned_to: null,
    workflow_assigned_to_name: null,
    fixture_release_state: "RELEASED",
  };
}

const FIXTURE_SECTION_ORDER = [
  { key: "UNASSIGNED", label: "Unassigned" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "OUTSOURCED", label: "Outsourced" },
  { key: "VERIFICATION", label: "Verification" },
  { key: "REWORK", label: "Rework" },
  { key: "WORKFLOW_COMPLETE", label: "Workflow Completed" },
] as const;

type FixtureSectionKey = (typeof FIXTURE_SECTION_ORDER)[number]["key"];

const FIXTURE_SECTION_STYLES: Record<FixtureSectionKey, {
  background: string;
  text: string;
  accent: string;
  description: string;
}> = {
  UNASSIGNED: {
    background: "#F1EFE8",
    text: "#444444",
    accent: "#666666",
    description: "No owner yet · waiting to be picked up",
  },
  ASSIGNED: {
    background: "#E6F1FB",
    text: "#0B4F9C",
    accent: "#1E6FBB",
    description: "Ownership confirmed · not yet started",
  },
  IN_PROGRESS: {
    background: "#EEEDFE",
    text: "#4B3FBF",
    accent: "#6A5ACD",
    description: "Actively being worked on",
  },
  OUTSOURCED: {
    background: "#FAEEDA",
    text: "#9A5A00",
    accent: "#D88900",
    description: "Delegated to external supplier",
  },
  VERIFICATION: {
    background: "#E1F5EE",
    text: "#006B5B",
    accent: "#009688",
    description: "Done · waiting for sign-off",
  },
  REWORK: {
    background: "#FCEBEB",
    text: "#B32626",
    accent: "#D32F2F",
    description: "Returned · needs correction",
  },
  WORKFLOW_COMPLETE: {
    background: "#EAF3DE",
    text: "#2F6B16",
    accent: "#5E9F2B",
    description: "Fully done · signed off",
  },
};

function compareFixtureNo(left: DesignFixtureOption, right: DesignFixtureOption) {
  return String(left.fixture_no || "").localeCompare(String(right.fixture_no || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortSectionFixtures(
  state: string,
  fixtures: DesignFixtureOption[],
  fixtureTaskById: Map<string, Task | null>,
) {
  return [...fixtures].sort((left, right) => {
    const leftTask = fixtureTaskById.get(left.fixture_id) || null;
    const rightTask = fixtureTaskById.get(right.fixture_id) || null;

    if (state === "VERIFICATION") {
      return new Date(getSubmittedValue(leftTask) || 0).getTime() - new Date(getSubmittedValue(rightTask) || 0).getTime();
    }

    if (state === "IN_PROGRESS") {
      return Number(rightTask?.completion_percent || 0) - Number(leftTask?.completion_percent || 0) || compareFixtureNo(left, right);
    }

    if (state === "REWORK") {
      return new Date(rightTask?.updated_at || rightTask?.created_at || 0).getTime()
        - new Date(leftTask?.updated_at || leftTask?.created_at || 0).getTime()
        || compareFixtureNo(left, right);
    }

    if (state === "ASSIGNED") {
      return new Date(leftTask?.deadline || "9999-12-31").getTime() - new Date(rightTask?.deadline || "9999-12-31").getTime()
        || compareFixtureNo(left, right);
    }

    if (state === "WORKFLOW_COMPLETE") {
      return new Date(right.workflow_released_at || rightTask?.approved_at || rightTask?.closed_at || 0).getTime()
        - new Date(left.workflow_released_at || leftTask?.approved_at || leftTask?.closed_at || 0).getTime()
        || compareFixtureNo(left, right);
    }

    return compareFixtureNo(left, right);
  });
}

export function ProjectFixtureOperationsGrid({
  fixtures,
  projectId,
  departmentId,
  readOnly = false,
  projectLabel = projectId,
}: ProjectFixtureOperationsGridProps) {
  const { access, user } = useAuth();
  const { tasks, refreshTasks } = useTasks();
  const queryClient = useQueryClient();
  const fallbackAssignableUsersQuery = useAssignableUsersQuery(!readOnly && access.canAssignTasks);
  const assignmentUsersQuery = useQuery({
    queryKey: ["task-assignment", "assignable-users", "department-workflow", departmentId || "self", projectId],
    queryFn: () => fetchTaskAssignmentUsers({
      task_type: "department_workflow",
      department_id: departmentId || null,
      project_id: projectId,
    }),
    enabled: Boolean(!readOnly && user?.employee_id && access.canAssignTasks && departmentId),
  });
  const twoDAssignmentUsersQuery = useQuery({
    queryKey: ["task-assignment", "assignable-users", "department-workflow", departmentId || "self", projectId, "2D Finish"],
    queryFn: () => fetchTaskAssignmentUsers({
      task_type: "department_workflow",
      department_id: departmentId || null,
      project_id: projectId,
      stage_name: "2D Finish",
    }),
    enabled: Boolean(!readOnly && user?.employee_id && access.canAssignTasks && departmentId),
  });
  const canViewStageOutsourceAssignments = hasAnyUserPermission(user, [
    UI_PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE,
    UI_PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE,
    UI_PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_CANCEL,
    UI_PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_REVIEW,
  ]);
  const canBulkOutsource = hasUserPermission(user, UI_PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE)
    && hasUserPermission(user, UI_PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_BULK);
  const stageOutsourceAssignmentsQuery = useQuery({
    queryKey: ["design", "outsource", "assignments", projectId],
    queryFn: () => fetchProjectOutsourceAssignments(projectId),
    enabled: Boolean(user?.employee_id && canViewStageOutsourceAssignments),
    retry: false,
  });
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [releaseFilter, setReleaseFilter] = useState<FixtureReleaseFilter>("ALL");
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    UNASSIGNED: true,
    ASSIGNED: true,
    IN_PROGRESS: true,
    OUTSOURCED: true,
    VERIFICATION: true,
    REWORK: true,
    WORKFLOW_COMPLETE: false,
  });
  const [releasedFixtureStatesById, setReleasedFixtureStatesById] = useState<Record<string, FixtureCurrentStage>>({});

  useEffect(() => {
    setReleasedFixtureStatesById((current) => {
      const fixturesById = new Map(fixtures.map((fixture) => [fixture.fixture_id, fixture]));
      const next = Object.fromEntries(
        Object.entries(current).filter(([fixtureId]) => {
          const fixture = fixturesById.get(fixtureId);
          return fixture
            && fixture.is_workflow_complete !== true
            && fixture.operational_state !== "WORKFLOW_COMPLETE";
        }),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [fixtures]);

  const visibleFixtures = useMemo(
    () => fixtures.map((fixture) => applyReleasedFixtureState(fixture, releasedFixtureStatesById[fixture.fixture_id])),
    [fixtures, releasedFixtureStatesById],
  );

  const filteredVisibleFixtures = useMemo(
    () => releaseFilter === "ALL"
      ? visibleFixtures
      : visibleFixtures.filter((fixture) => fixtureReleaseState(fixture) === releaseFilter),
    [releaseFilter, visibleFixtures],
  );

  const stageOutsourceAssignments = useMemo(
    () => stageOutsourceAssignmentsQuery.data ?? [],
    [stageOutsourceAssignmentsQuery.data],
  );
  const activeStageOutsourceAssignments = useMemo(
    () => stageOutsourceAssignments.filter((assignment) => assignment.status !== "CANCELLED"),
    [stageOutsourceAssignments],
  );
  const activeStageOutsourceFixtureIds = useMemo(
    () => new Set(activeStageOutsourceAssignments.map((assignment) => assignment.fixture_id)),
    [activeStageOutsourceAssignments],
  );

  const rememberReleasedFixtureState = useCallback((fixtureId: string, releaseState: FixtureCurrentStage) => {
    if (!releaseState.is_complete) {
      return;
    }

    setReleasedFixtureStatesById((current) => ({
      ...current,
      [fixtureId]: releaseState,
    }));
  }, []);

  const verificationQuery = useQuery({
    queryKey: taskQueryKeys.verificationQueue,
    queryFn: fetchVerificationTasks,
    enabled: Boolean(!readOnly && user?.employee_id && access.canViewVerifications),
  });

  const assignableUsers = assignmentUsersQuery.data ?? fallbackAssignableUsersQuery.data ?? [];
  const twoDAssignableUsers = twoDAssignmentUsersQuery.data ?? assignableUsers;
  const isLoadingAssignableUsers = assignmentUsersQuery.isLoading || (!assignmentUsersQuery.data && fallbackAssignableUsersQuery.isLoading);
  const isLoadingTwoDAssignableUsers = twoDAssignmentUsersQuery.isLoading || isLoadingAssignableUsers;

  const combinedTasks = useMemo(() => {
    const fixtureIds = new Set(visibleFixtures.map((fixture) => fixture.fixture_id));
    const taskById = new Map<number, Task>();

    [...tasks, ...(verificationQuery.data ?? [])].forEach((task) => {
      if (task.fixture_id && fixtureIds.has(task.fixture_id)) {
        taskById.set(task.id, task);
      }
    });

    return [...taskById.values()];
  }, [visibleFixtures, tasks, verificationQuery.data]);

  const fixtureTaskById = useMemo(() => {
    const map = new Map<string, Task | null>();
    visibleFixtures.forEach((fixture) => {
      map.set(fixture.fixture_id, pickFixtureTask(fixture, combinedTasks));
    });
    return map;
  }, [combinedTasks, visibleFixtures]);

  const operationalResolutionByFixtureId = useMemo(() => {
    const map = new Map<string, FixtureOperationalResolution>();
    visibleFixtures.forEach((fixture) => {
      map.set(fixture.fixture_id, resolveFixtureOperationalState(fixture, fixtureTaskById.get(fixture.fixture_id) || null));
    });
    return map;
  }, [fixtureTaskById, visibleFixtures]);

  const assignableFixtures = useMemo(
    () => readOnly ? [] : visibleFixtures.filter((fixture) => (
      !isFixtureActiveOutsourcedSection(fixture)
      && !activeStageOutsourceFixtureIds.has(fixture.fixture_id)
      && operationalResolutionByFixtureId.get(fixture.fixture_id)?.assignable === true
    )),
    [activeStageOutsourceFixtureIds, readOnly, visibleFixtures, operationalResolutionByFixtureId],
  );
  const assignableFixtureIds = useMemo(
    () => new Set(assignableFixtures.map((fixture) => fixture.fixture_id)),
    [assignableFixtures],
  );
  const eligibleSelectedFixtureIds = useMemo(
    () => selectedFixtureIds.filter((fixtureId) => assignableFixtureIds.has(fixtureId)),
    [assignableFixtureIds, selectedFixtureIds],
  );

  useEffect(() => {
    setSelectedFixtureIds((current) => current.filter((fixtureId) => assignableFixtureIds.has(fixtureId)));
  }, [assignableFixtureIds]);

  const fixtureSections = useMemo(() => {
    const seen = new Set<string>();

    return FIXTURE_SECTION_ORDER.map((section) => {
      const sectionFixtures = filteredVisibleFixtures.filter((fixture) => {
        if (seen.has(fixture.fixture_id)) {
          return false;
        }

        const isActiveOutsourced = isFixtureActiveOutsourcedSection(fixture)
          || activeStageOutsourceFixtureIds.has(fixture.fixture_id);
        const matches = section.key === "OUTSOURCED"
          ? isActiveOutsourced
          : !isActiveOutsourced && operationalResolutionByFixtureId.get(fixture.fixture_id)?.state === section.key;
        if (matches) {
          seen.add(fixture.fixture_id);
        }
        return matches;
      });

      return {
        ...section,
        fixtures: sortSectionFixtures(section.key, sectionFixtures, fixtureTaskById),
      };
    });
  }, [activeStageOutsourceFixtureIds, filteredVisibleFixtures, fixtureTaskById, operationalResolutionByFixtureId]);

  const invalidateOperationalState = useCallback(async () => {
    await Promise.all([
      refreshTasks(),
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.verificationQueue }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "fixtures", projectId, departmentId || undefined] }),
      queryClient.invalidateQueries({ queryKey: ["projects", "summary"] }),
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
      queryClient.invalidateQueries({ queryKey: batchQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: taskAssignmentQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users("assignable") }),
      queryClient.invalidateQueries({ queryKey: ["workflow"] }),
      queryClient.invalidateQueries({ queryKey: ["design", "outsourcing", "suppliers"] }),
      queryClient.invalidateQueries({ queryKey: ["design", "outsource", "assignments", projectId] }),
    ]);
  }, [departmentId, projectId, queryClient, refreshTasks]);

  const toggleSelectedFixture = useCallback((fixtureId: string, checked: boolean) => {
    setSelectedFixtureIds((current) => (
      checked
        ? Array.from(new Set([...current, fixtureId]))
        : current.filter((id) => id !== fixtureId)
    ));
  }, []);

  return (
    <div className="space-y-2">
      {!readOnly ? <div className="flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          variant={bulkPanelOpen ? "secondary" : "outline"}
          className="h-8 px-3 text-xs"
          onClick={() => setBulkPanelOpen((open) => !open)}
          disabled={!assignableFixtures.length}
        >
          <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
          Assign All
        </Button>
      </div> : null}

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Fixture release filter">
        {FIXTURE_RELEASE_FILTERS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={releaseFilter === option.value ? "secondary" : "ghost"}
            className="h-7 px-2.5 text-xs"
            aria-pressed={releaseFilter === option.value}
            onClick={() => {
              setSelectedFixtureIds([]);
              setReleaseFilter(option.value);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {!readOnly && bulkPanelOpen ? (
        <BulkFixtureAssignmentPanel
          assignableFixtures={assignableFixtures}
          selectedFixtureIds={eligibleSelectedFixtureIds}
          projectId={projectId}
          projectLabel={projectLabel}
          departmentId={departmentId || undefined}
          canBulkOutsource={canBulkOutsource}
          assignableUsers={assignableUsers}
          twoDAssignableUsers={twoDAssignableUsers}
          isLoadingUsers={isLoadingAssignableUsers}
          isLoadingTwoDUsers={isLoadingTwoDAssignableUsers}
          invalidateOperationalState={invalidateOperationalState}
          onFixtureReleased={rememberReleasedFixtureState}
          onCancel={() => setBulkPanelOpen(false)}
        />
      ) : null}

      <div className="space-y-3">
        {fixtureSections.map((section) => {
          const sectionStyle = FIXTURE_SECTION_STYLES[section.key];
          const legacyOutsourcedFixtures = section.key === "OUTSOURCED"
            ? section.fixtures.filter(isFixtureActiveOutsourcedSection)
            : [];
          const sectionCount = section.key === "OUTSOURCED"
            ? stageOutsourceAssignments.length + legacyOutsourcedFixtures.length
            : section.fixtures.length;

          return (
            <Collapsible
              key={section.key}
              open={openSections[section.key] ?? true}
              onOpenChange={(open) => setOpenSections((current) => ({ ...current, [section.key]: open }))}
              className="overflow-hidden rounded-lg border"
              style={{
                backgroundColor: sectionStyle.background,
                borderColor: sectionStyle.accent,
              }}
            >
              <CollapsibleTrigger
                className="flex w-full items-center justify-between gap-3 border-l-4 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                style={{
                  backgroundColor: sectionStyle.background,
                  borderLeftColor: sectionStyle.accent,
                  color: sectionStyle.text,
                }}
              >
                <span className="flex min-w-0 items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: sectionStyle.accent }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight" style={{ color: sectionStyle.text }}>{section.label}</span>
                    <span className="block text-xs leading-snug opacity-90">{sectionStyle.description}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className="font-semibold"
                    style={{
                      backgroundColor: sectionStyle.background,
                      borderColor: sectionStyle.accent,
                      color: sectionStyle.text,
                    }}
                  >
                    {sectionCount} {section.key === "OUTSOURCED" ? "record" : "fixture"}{sectionCount === 1 ? "" : "s"}
                  </Badge>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", openSections[section.key] ? "rotate-180" : "")} />
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t bg-background p-3" style={{ borderTopColor: sectionStyle.accent }}>
                {section.key === "OUTSOURCED" ? (
                  <div className="space-y-4">
                    <FixtureOutsourceAssignmentsTable
                      assignments={stageOutsourceAssignments}
                      isLoading={stageOutsourceAssignmentsQuery.isLoading}
                      error={stageOutsourceAssignmentsQuery.error instanceof Error ? stageOutsourceAssignmentsQuery.error : null}
                      onRetry={() => void stageOutsourceAssignmentsQuery.refetch()}
                    />
                    {legacyOutsourcedFixtures.length ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historical fixture-level outsourcing</p>
                        <OutsourcedFixturesTable
                          fixtures={legacyOutsourcedFixtures}
                          fixtureTaskById={fixtureTaskById}
                          operationalResolutionByFixtureId={operationalResolutionByFixtureId}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : section.fixtures.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No fixtures in this section.</p>
                ) : (
                  <div className="space-y-2">
                    {section.fixtures.map((fixture) => (
                      <ProjectFixtureCard
                        key={fixture.fixture_id}
                        fixture={fixture}
                        task={fixtureTaskById.get(fixture.fixture_id) || null}
                        projectId={projectId}
                        departmentId={departmentId || undefined}
                        assignableUsers={assignableUsers}
                        twoDAssignableUsers={twoDAssignableUsers}
                        isLoadingUsers={isLoadingAssignableUsers}
                        isLoadingTwoDUsers={isLoadingTwoDAssignableUsers}
                        invalidateOperationalState={invalidateOperationalState}
                        operationalResolution={operationalResolutionByFixtureId.get(fixture.fixture_id) || resolveFixtureOperationalState(fixture, fixtureTaskById.get(fixture.fixture_id) || null)}
                        onFixtureReleased={rememberReleasedFixtureState}
                        readOnly={readOnly || fixtureReleaseState(fixture) === "RELEASED"}
                        selectable={!readOnly && bulkPanelOpen && assignableFixtureIds.has(fixture.fixture_id)}
                        selected={selectedFixtureIds.includes(fixture.fixture_id)}
                        onSelectedChange={toggleSelectedFixture}
                      />
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

interface OutsourcedFixturesTableProps {
  fixtures: DesignFixtureOption[];
  fixtureTaskById: Map<string, Task | null>;
  operationalResolutionByFixtureId: Map<string, FixtureOperationalResolution>;
}

function OutsourcedFixturesTable({
  fixtures,
  fixtureTaskById,
  operationalResolutionByFixtureId,
}: OutsourcedFixturesTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[980px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[130px]">Fixture No</TableHead>
            <TableHead className="min-w-[200px]">Fixture Name</TableHead>
            <TableHead className="min-w-[160px]">Historical supplier</TableHead>
            <TableHead className="min-w-[150px]">Current Revision</TableHead>
            <TableHead className="min-w-[170px]">Current Status</TableHead>
            <TableHead className="min-w-[130px]">Outsourced Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fixtures.map((fixture) => {
            const currentStageOutsourced = isFixtureCurrentStageOutsourced(fixture);
            const operationalResolution = operationalResolutionByFixtureId.get(fixture.fixture_id)
              || resolveFixtureOperationalState(fixture, fixtureTaskById.get(fixture.fixture_id) || null);
            return (
              <TableRow key={fixture.fixture_id}>
                <TableCell className="align-top font-semibold">{fixture.fixture_no}</TableCell>
                <TableCell className="align-top">
                  <div className="max-w-[260px] whitespace-normal text-xs leading-snug">{fixture.part_name || "Not named"}</div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="max-w-[220px] whitespace-normal text-xs font-medium">{fixture.vendor_name || "Not set"}</div>
                  <div className="text-[11px] text-muted-foreground">Historical vendor record; not an employee</div>
                </TableCell>
                <TableCell className="align-top">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[11px] font-semibold",
                      currentStageOutsourced
                        ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                        : "border-indigo-300 bg-indigo-50 text-indigo-800",
                    )}
                  >
                    {getFixtureCurrentRevisionLabel(fixture)}
                  </Badge>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-col gap-1">
                    <span className="w-fit text-xs font-medium text-slate-700">
                      {fixtureStageStatusLabel(fixture.workflow_status || fixture.operational_state)}
                    </span>
                    {operationalResolution.activeAssigneeName ? (
                      <span className="text-[11px] text-muted-foreground">{operationalResolution.activeAssigneeName}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {formatDisplayDate(fixture.outsourced_at)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
function AdditionalAssigneePicker({
  users,
  primaryAssigneeId,
  selectedAssigneeIds,
  onSelectedAssigneeIdsChange,
  disabled = false,
}: {
  users: Array<{ employee_id: string; name: string }>;
  primaryAssigneeId: string;
  selectedAssigneeIds: string[];
  onSelectedAssigneeIdsChange: (assigneeIds: string[]) => void;
  disabled?: boolean;
}) {
  const additionalUsers = users.filter((employee) => employee.employee_id !== primaryAssigneeId);

  if (!primaryAssigneeId) {
    return (
      <p className="text-xs text-muted-foreground">Choose a primary 2D assignee before adding more employees.</p>
    );
  }

  if (additionalUsers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No additional 2D employees are available for this project route.</p>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {additionalUsers.map((employee) => {
        const checked = selectedAssigneeIds.includes(employee.employee_id);
        return (
          <label key={employee.employee_id} className="flex min-w-0 items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-xs">
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={(nextChecked) => {
                onSelectedAssigneeIdsChange(
                  nextChecked === true
                    ? Array.from(new Set([...selectedAssigneeIds, employee.employee_id]))
                    : selectedAssigneeIds.filter((employeeId) => employeeId !== employee.employee_id),
                );
              }}
            />
            <span className="min-w-0 truncate">{formatAssigneeOption(employee)}</span>
          </label>
        );
      })}
    </div>
  );
}

function DateOnlyDeadlinePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selectedDate = useMemo(() => {
    if (!value) {
      return undefined;
    }

    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) {
      return undefined;
    }

    return new Date(year, month - 1, day);
  }, [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-9 w-full justify-start px-3 text-left text-xs font-normal", !value && "text-muted-foreground")}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
          {formatDeadlineDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate || new Date()}
          onSelect={(date) => {
            if (date) {
              onChange(format(date, "yyyy-MM-dd"));
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

interface BulkFixtureAssignmentPanelProps {
  assignableFixtures: DesignFixtureOption[];
  selectedFixtureIds: string[];
  projectId: string;
  projectLabel: string;
  departmentId?: string;
  canBulkOutsource: boolean;
  assignableUsers: Array<{ employee_id: string; name: string }>;
  twoDAssignableUsers: Array<{ employee_id: string; name: string }>;
  isLoadingUsers: boolean;
  isLoadingTwoDUsers: boolean;
  invalidateOperationalState: () => Promise<void>;
  onFixtureReleased: (fixtureId: string, releaseState: FixtureCurrentStage) => void;
  onCancel: () => void;
}

function resolveBulkFixtureScope(
  assignableFixtures: DesignFixtureOption[],
  selectedFixtureIds: string[],
) {
  const useSelectedScope = selectedFixtureIds.length > 0;
  const selectedIds = new Set(selectedFixtureIds);
  const targetFixtures = useSelectedScope
    ? assignableFixtures.filter((fixture) => selectedIds.has(fixture.fixture_id))
    : assignableFixtures;

  return {
    targetFixtures,
    selectedFixtureIds: useSelectedScope
      ? targetFixtures.map((fixture) => fixture.fixture_id)
      : [],
    internalScope: useSelectedScope ? "selected" as const : "all_unassigned" as const,
    outsourceScope: useSelectedScope ? "selected" as const : "all_assignable" as const,
  };
}
function BulkFixtureAssignmentPanel({
  assignableFixtures,
  selectedFixtureIds,
  projectId,
  projectLabel,
  departmentId,
  canBulkOutsource,
  assignableUsers,
  twoDAssignableUsers,
  isLoadingUsers,
  isLoadingTwoDUsers,
  invalidateOperationalState,
  onFixtureReleased,
  onCancel,
}: BulkFixtureAssignmentPanelProps) {
  const { access } = useAuth();
  const [assignedTo, setAssignedTo] = useState("");
  const [additionalAssigneeIds, setAdditionalAssigneeIds] = useState<string[]>([]);
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("high");
  const [workflowTarget, setWorkflowTarget] = useState("");
  const [reasonType, setReasonType] = useState<FixtureRevisionType | "">("");
  const [outsourceDialogOpen, setOutsourceDialogOpen] = useState(false);
  const fixtureScope = useMemo(
    () => resolveBulkFixtureScope(assignableFixtures, selectedFixtureIds),
    [assignableFixtures, selectedFixtureIds],
  );
  const { internalScope: scope, outsourceScope, targetFixtures } = fixtureScope;
  const selectedFixtureCount = fixtureScope.selectedFixtureIds.length;

  const progressQueries = useQueries({
    queries: targetFixtures.map((fixture) => ({
      queryKey: ["workflow", "progress", departmentId || "self", fixture.fixture_id],
      queryFn: () => fetchFixtureFullProgress(fixture.fixture_id, departmentId),
      enabled: targetFixtures.length > 0,
    })),
  });

  const progressByFixtureId = useMemo(() => {
    const map = new Map<string, FixtureFullProgress>();
    targetFixtures.forEach((fixture, index) => {
      const progress = progressQueries[index]?.data;
      if (progress) {
        map.set(fixture.fixture_id, progress);
      }
    });
    return map;
  }, [progressQueries, targetFixtures]);

  const referenceProgress = progressQueries.find((query) => query.data)?.data;
  const currentStage = getCurrentProgressStage(referenceProgress);
  const workflowOptions = getAssignableWorkflowOptions(referenceProgress);

  useEffect(() => {
    if (!workflowTarget && currentStage?.stage_name) {
      setWorkflowTarget(currentStage.stage_name);
    }
  }, [currentStage?.stage_name, workflowTarget]);

  const workflowChanged = targetFixtures.some((fixture) => {
    const fixtureCurrent = getCurrentProgressStage(progressByFixtureId.get(fixture.fixture_id));
    return Boolean(workflowTarget && fixtureCurrent?.stage_name && workflowTarget !== fixtureCurrent.stage_name);
  });
  const selectedWorkflowStage = workflowOptions.find((stage) => stage.stage_name === workflowTarget) || null;
  const releaseSelected = isReleaseStageName(selectedWorkflowStage?.stage_name || workflowTarget);
  const releaseGateQueries = useQueries({
    queries: targetFixtures.map((fixture) => ({
      queryKey: ["workflow", "release-package", fixture.fixture_id, departmentId || "self"],
      queryFn: () => fetchFixtureReleasePackage(fixture.fixture_id, departmentId),
      enabled: releaseSelected,
      retry: false,
    })),
  });
  const releaseGateBusy = releaseSelected && releaseGateQueries.some((query) => query.isLoading);
  const releaseGateErrors = releaseSelected
    ? releaseGateQueries.flatMap((query, index) => query.error instanceof Error
      ? [{ fixture_no: targetFixtures[index]?.fixture_no || "Fixture", message: query.error.message }]
      : [])
    : [];
  const bulkReleaseBlockers = releaseSelected
    ? releaseGateQueries.flatMap((query, index) => (query.data?.blockers || []).map((blocker) => ({
      fixture_no: targetFixtures[index]?.fixture_no || "Fixture",
      message: blocker.message,
    })))
    : [];
  const releaseGateReady = releaseSelected
    && targetFixtures.length > 0
    && releaseGateQueries.every((query) => query.data?.available_actions.includes("RELEASE") === true);
  const isTwoDWorkflowTarget = isTwoDStageName(selectedWorkflowStage?.stage_name || workflowTarget);
  const assignmentUsersForTarget = isTwoDWorkflowTarget ? twoDAssignableUsers : assignableUsers;
  const isLoadingUsersForTarget = isTwoDWorkflowTarget ? isLoadingTwoDUsers : isLoadingUsers;
  const selectedAssigneeIds = buildSelectedAssigneeIds(assignedTo, additionalAssigneeIds, isTwoDWorkflowTarget);
  const canSubmitWorkflowAction = releaseSelected
    ? access.canChangeFixtureStage
    : access.canAssignTasks && access.canCreateTasks && access.canChangeFixtureStage;
  const workflowChangeAllowed = !workflowChanged || reasonType === "MANUAL_OVERRIDE" || selectedWorkflowStage?.status === "APPROVED";
  const progressLoading = progressQueries.some((query) => query.isLoading);
  const selectedScopeEmpty = scope === "selected" && targetFixtures.length === 0;
  const requiresReasonType = workflowChanged && !releaseSelected;

  const resetForm = () => {
    setAssignedTo("");
    setAdditionalAssigneeIds([]);
    setDeadline("");
    setPriority("high");
    setWorkflowTarget("");
    setReasonType("");
  };

  useEffect(() => {
    if (!isTwoDWorkflowTarget) {
      setAdditionalAssigneeIds([]);
      return;
    }

    const availableIds = new Set(twoDAssignableUsers.map((employee) => employee.employee_id));
    setAdditionalAssigneeIds((current) => current.filter((employeeId) => (
      employeeId !== assignedTo && availableIds.has(employeeId)
    )));
  }, [assignedTo, isTwoDWorkflowTarget, twoDAssignableUsers]);

  const bulkAssignMutation = useMutation({
    mutationFn: async () => {
      if (!targetFixtures.length) {
        throw new Error(scope === "selected" ? "Select fixtures before assigning" : "No unassigned fixtures are available");
      }

      if (!workflowTarget) {
        throw new Error("Workflow is required");
      }

      if (!releaseSelected && (!assignedTo || !deadline)) {
        throw new Error("Employee, deadline, priority, and workflow are required");
      }

      if (requiresReasonType && !reasonType) {
        throw new Error("Reason Type is required when workflow is changed");
      }

      let assignedCount = 0;
      let skippedCount = 0;

      for (const fixture of targetFixtures) {
        if (releaseSelected) {
          const releaseState = await releaseFixtureWorkflow({
            fixture_id: fixture.fixture_id,
            department_id: departmentId,
          });
          onFixtureReleased(fixture.fixture_id, releaseState);
          assignedCount += 1;
          continue;
        }

        const validation = await validateFixtureAssignment(fixture.fixture_id, departmentId);
        if (validation.canAssign !== true) {
          skippedCount += 1;
          continue;
        }

        const progress = progressByFixtureId.get(fixture.fixture_id) || await fetchFixtureFullProgress(fixture.fixture_id, departmentId);
        const fixtureCurrent = getCurrentProgressStage(progress);
        const fixtureWorkflowChanged = Boolean(workflowTarget && fixtureCurrent?.stage_name && workflowTarget !== fixtureCurrent.stage_name);

        if (fixtureWorkflowChanged) {
          if (reasonType === "MANUAL_OVERRIDE") {
            await manipulateFixtureStage({
              fixture_id: fixture.fixture_id,
              department_id: departmentId,
              target_stage_name: workflowTarget,
              target_status: "PENDING",
              reason_type: "MANUAL_OVERRIDE",
              revision_type: "MANUAL_OVERRIDE",
              revision_reason: "Manual override selected during assignment workflow change",
              remarks: "Manual override selected during assignment workflow change",
            });
          } else {
            await reopenFixtureStage({
              fixture_id: fixture.fixture_id,
              department_id: departmentId,
              target_stage_name: workflowTarget,
              revision_type: reasonType as FixtureRevisionType,
            });
          }
        }


        await createDesignTask({
          department_id: departmentId,
          project_id: projectId,
          fixture_id: fixture.fixture_id,
          description: fixture.part_name || fixture.fixture_no,
          assigned_to: selectedAssigneeIds[0],
          assignee_ids: selectedAssigneeIds,
          priority,
          deadline: normalizeDeadlineToEndOfDayIso(deadline),
        });
        assignedCount += 1;
      }

      if (assignedCount === 0) {
        throw new Error(skippedCount > 0 ? "No selected fixtures are currently assignable" : "No fixtures were assigned");
      }
    },
    onSuccess: async () => {
      await invalidateOperationalState();
      resetForm();
      onCancel();
      toast({
        title: releaseSelected ? "Fixtures released" : "Fixtures assigned",
        description: releaseSelected
          ? "Release completed without creating task assignments."
          : "Assign All reused the existing assignment flow for each fixture.",
      });
    },
    onError: (error) => {
      toast({
        title: "Assign All failed",
        description: error instanceof Error ? error.message : "Could not assign fixtures",
        variant: "destructive",
      });
    },
  });

  const disabled = (!releaseSelected && (!assignedTo || !deadline))
    || !canSubmitWorkflowAction
    || !workflowTarget
    || progressLoading
    || selectedScopeEmpty
    || !workflowChangeAllowed
    || (requiresReasonType && !reasonType)
    || bulkAssignMutation.isPending
    || (releaseSelected && (!releaseGateReady || releaseGateBusy || releaseGateErrors.length > 0))
    || (!releaseSelected && isLoadingUsersForTarget);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <BulkOutsourceDialog
        open={outsourceDialogOpen}
        onOpenChange={setOutsourceDialogOpen}
        projectId={projectId}
        projectLabel={projectLabel}
        workflowStage={workflowTarget}
        scope={outsourceScope}
        fixtureIds={fixtureScope.selectedFixtureIds}
        requestedCount={targetFixtures.length}
        coordinators={assignmentUsersForTarget}
        onCompleted={invalidateOperationalState}
      />
      <div className="grid gap-2 lg:grid-cols-4">
        {!releaseSelected ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Employee</Label>
              <Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}>
                <SelectTrigger className="h-9 bg-white text-xs" disabled={isLoadingUsersForTarget || bulkAssignMutation.isPending}>
                  <SelectValue placeholder={isLoadingUsersForTarget ? "Loading..." : "Employee"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Employee</SelectItem>
                  {assignmentUsersForTarget.map((employee) => (
                    <SelectItem key={employee.employee_id} value={employee.employee_id}>
                      {formatAssigneeOption(employee)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Deadline</Label>
              <DateOnlyDeadlinePicker value={deadline} onChange={setDeadline} disabled={bulkAssignMutation.isPending} />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger className="h-9 bg-white text-xs" disabled={bulkAssignMutation.isPending}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}

        {!releaseSelected && isTwoDWorkflowTarget ? (
          <div className="space-y-1 lg:col-span-4">
            <Label className="text-xs">Additional 2D Employees</Label>
            <AdditionalAssigneePicker
              users={assignmentUsersForTarget}
              primaryAssigneeId={assignedTo}
              selectedAssigneeIds={additionalAssigneeIds}
              onSelectedAssigneeIdsChange={setAdditionalAssigneeIds}
              disabled={bulkAssignMutation.isPending}
            />
          </div>
        ) : null}

        <div className="space-y-1">
          <Label className="text-xs">Workflow</Label>
          <Select
            value={workflowTarget || "__none__"}
            onValueChange={(value) => {
              setWorkflowTarget(value === "__none__" ? "" : value);
              setReasonType("");
            }}
            disabled={progressLoading || bulkAssignMutation.isPending}
          >
            <SelectTrigger className="h-9 bg-white text-xs">
              <SelectValue placeholder={progressLoading ? "Loading workflow..." : "Workflow"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Workflow</SelectItem>
              {workflowOptions.map((stage) => (
                <SelectItem key={`${stage.stage_name}-${stage.stage_version}`} value={stage.stage_name}>
                  {stage.stage_label || stage.stage_name} ({getStageWorkflowCode(stage)}) - {fixtureStageStatusLabel(stage.status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {requiresReasonType ? (
        <div className="mt-2 max-w-sm space-y-1">
          <Label className="text-xs">Reason Type</Label>
          <Select value={reasonType || "__none__"} onValueChange={(value) => setReasonType(value === "__none__" ? "" : value as FixtureRevisionType)}>
            <SelectTrigger className="h-9 bg-white text-xs" disabled={bulkAssignMutation.isPending}>
              <SelectValue placeholder="Reason Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Reason Type</SelectItem>
              {revisionReasonOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!workflowChangeAllowed ? (
            <p className="text-xs text-amber-700">Previous stage must be approved before changing workflow.</p>
          ) : null}
        </div>
      ) : null}

      {releaseSelected && releaseGateBusy ? (
        <p className="mt-2 text-xs text-muted-foreground">Checking backend release gates...</p>
      ) : null}
      {releaseSelected && (bulkReleaseBlockers.length > 0 || releaseGateErrors.length > 0) ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" role="alert">
          <p className="font-semibold">Release blocked</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {[...bulkReleaseBlockers, ...releaseGateErrors].map((blocker, index) => (
              <li key={`${blocker.fixture_no}-${blocker.message}-${index}`}>{blocker.fixture_no}: {blocker.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <Label className="text-xs">Assignment Scope</Label>
          <RadioGroup value={scope} onValueChange={() => undefined} className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs">
              <RadioGroupItem value="all_unassigned" disabled={selectedFixtureCount > 0} />
              All Assignable Fixtures ({assignableFixtures.length})
            </label>
            <label className="flex items-center gap-2 text-xs">
              <RadioGroupItem value="selected" disabled={selectedFixtureCount === 0} />
              Selected Fixtures ({selectedFixtureCount})
            </label>
          </RadioGroup>
          {selectedScopeEmpty ? (
            <p className="text-xs text-amber-700">Select fixtures in the grid before using selected scope.</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={bulkAssignMutation.isPending}>
            Cancel
          </Button>
          {canBulkOutsource ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!workflowTarget || progressLoading || selectedScopeEmpty || bulkAssignMutation.isPending}
              onClick={() => setOutsourceDialogOpen(true)}
            >
              <Factory className="mr-1.5 h-3.5 w-3.5" /> Outsource
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={() => bulkAssignMutation.mutate()} disabled={disabled}>
            {bulkAssignMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {releaseSelected ? "Release" : "Assign All"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ProjectFixtureCardProps {
  fixture: DesignFixtureOption;
  task: Task | null;
  projectId: string;
  departmentId?: string;
  assignableUsers: Array<{ employee_id: string; name: string }>;
  twoDAssignableUsers: Array<{ employee_id: string; name: string }>;
  isLoadingUsers: boolean;
  isLoadingTwoDUsers: boolean;
  invalidateOperationalState: () => Promise<void>;
  operationalResolution: FixtureOperationalResolution;
  onFixtureReleased: (fixtureId: string, releaseState: FixtureCurrentStage) => void;
  readOnly: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (fixtureId: string, checked: boolean) => void;
}

function ProjectFixtureCard({
  fixture,
  task,
  projectId,
  departmentId,
  assignableUsers,
  twoDAssignableUsers,
  isLoadingUsers,
  isLoadingTwoDUsers,
  invalidateOperationalState,
  operationalResolution,
  onFixtureReleased,
  readOnly,
  selectable = false,
  selected = false,
  onSelectedChange,
}: ProjectFixtureCardProps) {
  const { access, user } = useAuth();
  const [expanded, setExpanded] = useState<"assign" | "transfer" | null>(null);
  const [assignedTo, setAssignedTo] = useState("");
  const [additionalAssigneeIds, setAdditionalAssigneeIds] = useState<string[]>([]);
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("high");
  const [workflowTarget, setWorkflowTarget] = useState("");
  const [reasonType, setReasonType] = useState<FixtureRevisionType | "">("");
  const [transferTo, setTransferTo] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [rejectingTask, setRejectingTask] = useState<Task | null>(null);
  const [cancellingTask, setCancellingTask] = useState<Task | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [inlineOperationalReason, setInlineOperationalReason] = useState<string | null>(null);
  const [openingAssign, setOpeningAssign] = useState(false);
  const [releasePackageStatus, setReleasePackageStatus] = useState<FixtureReleasePackageResponse | null>(null);

  const canDeployDesignTask = !readOnly && access.canAssignTasks && access.canCreateTasks && access.canChangeFixtureStage;
  const fixtureAtReleaseStage = isReleaseStageName(fixture.workflow_stage || fixture.workflow_stage_label);
  const completedPercent = Math.max(0, Math.min(100, Number(task?.completion_percent ?? 0)));
  const remainingPercent = Math.max(0, 100 - completedPercent);
  const canTransferTask = Boolean(
    !readOnly
    && task
    && remainingPercent > 0
    && (access.canTransferTasks || access.canAssignTasks)
    && !["closed", "cancelled", "under_review"].includes(task.status),
  );
  const canReviewTask = Boolean(
    !readOnly
    && task
    && task.status === "under_review"
    && task.verification_status === "pending"
    && (access.canApproveCompletedTasks || access.canApproveQuality),
  ) && (!isTaskAssignedToCurrentUser(task, user?.employee_id) || access.canSelfApprove);

  const progressQuery = useQuery({
    queryKey: ["workflow", "progress", departmentId || "self", fixture.fixture_id],
    queryFn: () => fetchFixtureFullProgress(fixture.fixture_id, departmentId),
    enabled: !readOnly && expanded === "assign",
  });

  const validationQuery = useQuery({
    queryKey: ["workflow", "validate", departmentId || "self", fixture.fixture_id],
    queryFn: () => validateFixtureAssignment(fixture.fixture_id, departmentId),
    enabled: false,
  });

  const progress = progressQuery.data;
  const currentProgressStage = useMemo(() => getCurrentProgressStage(progress), [progress]);
  const canonicalOperationalState = operationalResolution.state;
  const isWorkflowCompleteReassign = canonicalOperationalState === "WORKFLOW_COMPLETE";
  const workflowOptions = useMemo(() => {
    const options = getAssignableWorkflowOptions(progress);
    return isWorkflowCompleteReassign
      ? options.filter((stage) => !isReleaseStageName(stage.stage_name))
      : options;
  }, [isWorkflowCompleteReassign, progress]);

  useEffect(() => {
    if (expanded !== "assign" || workflowTarget || !currentProgressStage?.stage_name) {
      return;
    }

    setWorkflowTarget(currentProgressStage.stage_name);
  }, [currentProgressStage?.stage_name, expanded, workflowTarget]);

  const selectedWorkflowStage = workflowOptions.find((stage) => stage.stage_name === workflowTarget) || null;
  const releaseSelected = isReleaseStageName(selectedWorkflowStage?.stage_name || workflowTarget);
  const isTwoDWorkflowTarget = isTwoDStageName(selectedWorkflowStage?.stage_name || workflowTarget);
  const assignmentUsersForTarget = isTwoDWorkflowTarget ? twoDAssignableUsers : assignableUsers;
  const isLoadingUsersForTarget = isTwoDWorkflowTarget ? isLoadingTwoDUsers : isLoadingUsers;
  const selectedAssigneeIds = buildSelectedAssigneeIds(assignedTo, additionalAssigneeIds, isTwoDWorkflowTarget);
  const canOpenWorkflowAction = !readOnly && (
    isWorkflowCompleteReassign
      ? canDeployDesignTask
      : fixtureAtReleaseStage
        ? access.canChangeFixtureStage
        : canDeployDesignTask
  );
  const canSubmitWorkflowAction = !readOnly && (releaseSelected ? access.canChangeFixtureStage : canDeployDesignTask);
  const workflowChanged = Boolean(workflowTarget && workflowTarget !== currentProgressStage?.stage_name);
  const canAssignCurrent = validationQuery.data?.canAssign === true;
  const assignmentBlockedReason = validationQuery.data?.reason || null;
  const workflowChangeAllowed = workflowChanged && Boolean(selectedWorkflowStage);
  const canSubmitAssignment = releaseSelected || (workflowChanged ? workflowChangeAllowed : canAssignCurrent);
  const requiresReasonType = workflowChanged && !releaseSelected && !isWorkflowCompleteReassign;
  const releaseEnabledByBackend = releasePackageStatus?.available_actions.includes("RELEASE") === true;

  const proofImage = getProofImage(task);
  const isSubmittedForVerification = canonicalOperationalState === "VERIFICATION";
  const isAssigned = canonicalOperationalState !== "UNASSIGNED" && canonicalOperationalState !== "WORKFLOW_COMPLETE";
  const workflowCode = getFixtureWorkflowCode(fixture);
  const releaseDateLabel = formatDisplayDate(getFixtureReleaseDate(fixture), "Not recorded");
  const releasedByLabel = getFixtureReleasedBy(fixture);
  const canCancelTask = !readOnly && canCancelFixtureOperationalTask(task, canonicalOperationalState, user, access);

  const resetAssignForm = () => {
    setAssignedTo("");
    setAdditionalAssigneeIds([]);
    setDeadline("");
    setPriority("high");
    setWorkflowTarget("");
    setReasonType("");
  };

  const resetTransferForm = () => {
    setTransferTo("");
    setTransferReason("");
  };

  useEffect(() => {
    if (!isTwoDWorkflowTarget) {
      setAdditionalAssigneeIds([]);
      return;
    }

    const availableIds = new Set(twoDAssignableUsers.map((employee) => employee.employee_id));
    setAdditionalAssigneeIds((current) => current.filter((employeeId) => (
      employeeId !== assignedTo && availableIds.has(employeeId)
    )));
  }, [assignedTo, isTwoDWorkflowTarget, twoDAssignableUsers]);

  const openAssignExpansion = async () => {
    setInlineOperationalReason(null);

    if (!operationalResolution.assignable && !isWorkflowCompleteReassign) {
      setInlineOperationalReason(operationalResolution.reason || "Workflow locked");
      setExpanded(null);
      return;
    }

    setOpeningAssign(true);
    try {
      if (!isWorkflowCompleteReassign) {
        const validation = await validationQuery.refetch();
        if (validation.data?.canAssign !== true) {
          setInlineOperationalReason(validation.data?.reason || "Workflow locked");
          setExpanded(null);
          return;
        }
      }

      setExpanded(expanded === "assign" ? null : "assign");
      resetTransferForm();
    } catch (error) {
      setInlineOperationalReason(error instanceof Error ? error.message : "Workflow locked");
      setExpanded(null);
    } finally {
      setOpeningAssign(false);
    }
  };

  const assignMutation = useMutation({
    mutationFn: async (): Promise<{ action: "release"; releaseState: FixtureCurrentStage } | { action: "assignment" }> => {
      if (releaseSelected) {
        const releaseState = await releaseFixtureWorkflow({
          fixture_id: fixture.fixture_id,
          department_id: departmentId,
        });
        return { action: "release", releaseState };
      }
      if (!assignedTo || !deadline) {
        throw new Error("Assignee and deadline are required");
      }

      if (workflowChanged) {
        const resolvedReasonType = reasonType || (isWorkflowCompleteReassign ? "CUSTOMER_REVISION" : "");

        if (!resolvedReasonType) {
          throw new Error("Reason Type is required when workflow is changed");
        }

        if (resolvedReasonType === "MANUAL_OVERRIDE") {
          await manipulateFixtureStage({
            fixture_id: fixture.fixture_id,
            department_id: departmentId,
            target_stage_name: workflowTarget,
            target_status: "PENDING",
            reason_type: "MANUAL_OVERRIDE",
            revision_type: "MANUAL_OVERRIDE",
            revision_reason: "Manual override selected during assignment workflow change",
            remarks: "Manual override selected during assignment workflow change",
          });
        } else {
          await reopenFixtureStage({
            fixture_id: fixture.fixture_id,
            department_id: departmentId,
            target_stage_name: workflowTarget,
            revision_type: resolvedReasonType as FixtureRevisionType,
            revision_reason: isWorkflowCompleteReassign ? "Post-release reassignment" : undefined,
            remarks: isWorkflowCompleteReassign ? "Customer-requested change after Release" : undefined,
          });
        }
      }

      await createDesignTask({
        department_id: departmentId,
        project_id: projectId,
        fixture_id: fixture.fixture_id,
        description: fixture.part_name || fixture.fixture_no,
        assigned_to: selectedAssigneeIds[0],
        assignee_ids: selectedAssigneeIds,
        priority,
        deadline: normalizeDeadlineToEndOfDayIso(deadline),
      });
      return { action: "assignment" };
    },
    onSuccess: async (result) => {
      if (result.action === "release") {
        onFixtureReleased(fixture.fixture_id, result.releaseState);
      }
      await invalidateOperationalState();
      resetAssignForm();
      setExpanded(null);
      toast({
        title: releaseSelected ? "Fixture released" : isWorkflowCompleteReassign ? "Fixture re-assigned" : "Fixture assigned",
        description: releaseSelected
          ? "The fixture moved to Workflow Complete without creating a task assignment."
          : "The existing workflow assignment was created for this fixture.",
      });
    },
    onError: (error) => {
      toast({
        title: "Assignment failed",
        description: error instanceof Error ? error.message : "Could not assign fixture",
        variant: "destructive",
      });
    },
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!task) {
        throw new Error("No active task is available for transfer");
      }

      if (!transferTo) {
        throw new Error("Transfer employee is required");
      }

      await transferTask(task.id, {
        transfer_to: transferTo,
        transfer_reason: transferReason.trim() || "Inline fixture transfer",
        completion_percent: completedPercent,
      });
    },
    onSuccess: async () => {
      await invalidateOperationalState();
      resetTransferForm();
      setExpanded(null);
      toast({ title: "Fixture transferred", description: `Remaining ${remainingPercent}% was transferred.` });
    },
    onError: (error) => {
      toast({
        title: "Transfer failed",
        description: error instanceof Error ? error.message : "Could not transfer fixture",
        variant: "destructive",
      });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ reviewTask, action, remarks }: { reviewTask: Task; action: "approve" | "reject"; remarks?: string }) => {
      await updateTask(reviewTask.id, {
        verification_action: action,
        remarks,
      });
    },
    onSuccess: async (_, variables) => {
      await invalidateOperationalState();
      setRejectingTask(null);
      setRejectionReason("");
      toast({
        title: variables.action === "approve" ? "Fixture approved" : "Fixture rejected",
        description: variables.action === "approve"
          ? "The existing verification flow advanced the workflow."
          : "The existing rejection flow preserved the workflow history.",
      });
    },
    onError: (error) => {
      toast({
        title: "Review not saved",
        description: error instanceof Error ? error.message : "Task is not in verification state.",
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (cancelTask: Task) => {
      await cancelTaskRequest(
        cancelTask.id,
        "Cancel this assigned task and return fixture to Unassigned state?",
      );
    },
    onSuccess: async () => {
      await invalidateOperationalState();
      setCancellingTask(null);
      setExpanded(null);
      resetAssignForm();
      resetTransferForm();
      toast({
        title: "Fixture returned to Unassigned",
        description: "The task was cancelled and the workflow stage is assignable again.",
      });
    },
    onError: (error) => {
      toast({
        title: "Cancellation failed",
        description: error instanceof Error ? error.message : "Could not cancel fixture assignment",
        variant: "destructive",
      });
    },
  });

  const assignmentDisabled = !canSubmitWorkflowAction
    || (!releaseSelected && (!assignedTo || !deadline))
    || !workflowTarget
    || progressQuery.isLoading
    || validationQuery.isLoading
    || !canSubmitAssignment
    || (requiresReasonType && !reasonType)
    || assignMutation.isPending
    || (releaseSelected && !releaseEnabledByBackend)
    || (!releaseSelected && isLoadingUsersForTarget);

  const transferDisabled = !task
    || !transferTo
    || remainingPercent <= 0
    || transferMutation.isPending;
  return (
    <div
      className={cn(
        "rounded-md border border-slate-200 bg-background px-3 py-2 transition-colors hover:bg-slate-50/70",
        selected && "border-primary bg-primary/5 hover:bg-primary/5",
      )}
    >
      <div className="space-y-2">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1.5fr)_auto_minmax(140px,auto)_minmax(150px,auto)_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-2">
            {selectable ? (
              <Checkbox
                className="mt-0.5"
                checked={selected}
                onCheckedChange={(checked) => onSelectedChange?.(fixture.fixture_id, checked === true)}
                aria-label={`Select ${fixture.fixture_no}`}
              />
            ) : null}
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold text-sm leading-tight">{fixture.fixture_no}</p>
              <p className="break-words text-xs leading-snug text-muted-foreground">{fixture.part_name}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 lg:justify-center">
            {workflowCode ? (
              <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-xs font-semibold text-indigo-800">
                {workflowCode}
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "max-w-full gap-0.5 text-xs font-medium",
                isAssigned
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-slate-300 bg-slate-50 text-slate-500",
              )}
            >
              {isAssigned ? <UserCheck className="h-3 w-3 shrink-0" /> : <UserX className="h-3 w-3 shrink-0" />}
              <span className="break-words">{isAssigned ? operationalResolution.activeAssigneeName || getAssigneeName(fixture, task) : "Unassigned"}</span>
            </Badge>
          </div>

          <div className="min-w-0 text-xs text-muted-foreground">
            {isAssigned && !isSubmittedForVerification ? (
              <div className="space-y-1">
                {task ? (
                  <div className="flex items-center gap-2">
                    <User className="h-3 w-3 shrink-0" />
                    <Progress value={completedPercent} className="h-1.5 w-16 shrink-0" />
                    <span className="font-semibold text-foreground">{completedPercent}%</span>
                  </div>
                ) : null}
                <p>Submitted: {formatSubmittedDate(getSubmittedValue(task))}</p>
              </div>
            ) : isAssigned ? (
              <span>Submitted: {formatSubmittedDate(getSubmittedValue(task))}</span>
            ) : null}
          </div>

          <div className="flex flex-col items-start gap-1.5 lg:items-end">
            <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
              {isSubmittedForVerification && canReviewTask ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"
                    disabled={reviewMutation.isPending}
                    onClick={() => {
                      if (task) {
                        reviewMutation.mutate({ reviewTask: task, action: "approve" });
                      }
                    }}
                  >
                    APPROVE
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-[11px]"
                    disabled={reviewMutation.isPending}
                    onClick={() => {
                      setRejectingTask(task);
                      setRejectionReason("");
                    }}
                  >
                    REJECT
                  </Button>
                </>
              ) : isAssigned && (canTransferTask || canCancelTask) ? (
                <>
                  {canTransferTask ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => {
                        setExpanded(expanded === "transfer" ? null : "transfer");
                        resetAssignForm();
                        setInlineOperationalReason(null);
                      }}
                    >
                      <ArrowRightLeft className="mr-1 h-3 w-3" />
                      Transfer
                    </Button>
                  ) : null}
                  {canCancelTask ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 border-red-200 px-2 text-[11px] text-red-700 hover:bg-red-50 hover:text-red-800"
                      disabled={cancelMutation.isPending}
                      onClick={() => {
                        if (task) {
                          setCancellingTask(task);
                        }
                      }}
                    >
                      <XCircle className="mr-1 h-3 w-3" />
                      Cancel Task
                    </Button>
                  ) : null}
                </>
              ) : (operationalResolution.assignable || isWorkflowCompleteReassign) && canOpenWorkflowAction ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  disabled={openingAssign}
                  onClick={() => void openAssignExpansion()}
                >
                  {openingAssign ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  {isWorkflowCompleteReassign ? "Re-Assign" : "Assign Now"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {isSubmittedForVerification ? (
          <div className="space-y-2 rounded-md bg-slate-50/70 p-2">
            {proofImage ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="block h-20 w-28 overflow-hidden rounded-md border bg-slate-50"
                  onClick={() => setPreviewImage(resolveImageUrl(proofImage))}
                >
                  <SafeImage src={proofImage} alt={`${fixture.fixture_no} proof`} className="h-full w-full object-cover" />
                </button>
                <div className="min-w-0 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Work proof</p>
                  <p>{formatSubmittedDate(getProofUploadedAt(task))}</p>
                  <p className="break-words">{getProofUploadedBy(task) || "Unknown uploader"}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-16 w-24 items-center justify-center rounded-md border border-dashed bg-slate-50 text-slate-400">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
          </div>
        ) : null}

        {inlineOperationalReason ? (
          <p className="text-xs font-medium text-amber-700">{inlineOperationalReason}</p>
        ) : null}

        {isWorkflowCompleteReassign ? (
          <div className="grid gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-2 text-[11px] sm:grid-cols-4">
            <div>
              <p className="font-semibold uppercase tracking-wide text-emerald-800">Current Revision</p>
              <p className="mt-0.5 text-slate-700">{workflowCode || "Not recorded"}</p>
            </div>
            <div>
              <p className="font-semibold uppercase tracking-wide text-emerald-800">Release Date</p>
              <p className="mt-0.5 text-slate-700">{releaseDateLabel}</p>
            </div>
            <div>
              <p className="font-semibold uppercase tracking-wide text-emerald-800">Released By</p>
              <p className="mt-0.5 break-words text-slate-700">{releasedByLabel}</p>
            </div>
            <div>
              <p className="font-semibold uppercase tracking-wide text-emerald-800">Current Status</p>
              <p className="mt-0.5 text-slate-700">Released</p>
            </div>
          </div>
        ) : null}
      </div>

      {expanded === "assign" ? (
        <div className="mt-2 space-y-2 border-t pt-2">
          {!releaseSelected ? (
            <div className="grid gap-2 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Assignee</Label>
                <Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}>
                  <SelectTrigger className="h-9 text-xs" disabled={isLoadingUsersForTarget || assignMutation.isPending}>
                    <SelectValue placeholder={isLoadingUsersForTarget ? "Loading..." : "Assignee"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Assignee</SelectItem>
                    {assignmentUsersForTarget.map((employee) => (
                      <SelectItem key={employee.employee_id} value={employee.employee_id}>
                        {formatAssigneeOption(employee)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Deadline</Label>
                <DateOnlyDeadlinePicker
                  value={deadline}
                  onChange={setDeadline}
                  disabled={assignMutation.isPending}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                  <SelectTrigger className="h-9 text-xs" disabled={assignMutation.isPending}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {!releaseSelected && isTwoDWorkflowTarget ? (
            <div className="space-y-1">
              <Label className="text-xs">Additional 2D Employees</Label>
              <AdditionalAssigneePicker
                users={assignmentUsersForTarget}
                primaryAssigneeId={assignedTo}
                selectedAssigneeIds={additionalAssigneeIds}
                onSelectedAssigneeIdsChange={setAdditionalAssigneeIds}
                disabled={assignMutation.isPending}
              />
            </div>
          ) : null}

          <div className="space-y-1">
            <Label className="text-xs">Workflow</Label>
            <Select
              value={workflowTarget || "__none__"}
              onValueChange={(value) => {
                setWorkflowTarget(value === "__none__" ? "" : value);
                setReasonType("");
              }}
              disabled={progressQuery.isLoading || assignMutation.isPending}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder={progressQuery.isLoading ? "Loading workflow..." : "Workflow"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Workflow</SelectItem>
                {workflowOptions.map((stage) => (
                  <SelectItem key={`${stage.stage_name}-${stage.stage_version}`} value={stage.stage_name}>
                    {stage.stage_label || stage.stage_name} ({getStageWorkflowCode(stage)}) - {fixtureStageStatusLabel(stage.status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requiresReasonType ? (
            <div className="space-y-1">
              <Label className="text-xs">Reason Type</Label>
              <Select value={reasonType || "__none__"} onValueChange={(value) => setReasonType(value === "__none__" ? "" : value as FixtureRevisionType)}>
                <SelectTrigger className="h-9 text-xs" disabled={assignMutation.isPending}>
                  <SelectValue placeholder="Reason Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Reason Type</SelectItem>
                  {revisionReasonOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!workflowChangeAllowed ? (
                <p className="text-xs text-amber-700">Choose a configured workflow stage.</p>
              ) : null}
            </div>
          ) : null}

          {!workflowChanged && assignmentBlockedReason ? (
            <p className="text-xs text-red-600">{assignmentBlockedReason}</p>
          ) : null}

          {releaseSelected && releasePackageStatus?.blockers.length ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              {releasePackageStatus.blockers.map((blocker, index) => (
                <p key={blocker.code + "-" + index}>{blocker.message}</p>
              ))}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetAssignForm();
                setExpanded(null);
              }}
              disabled={assignMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => assignMutation.mutate()}
              disabled={assignmentDisabled}
            >
              {assignMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : releaseSelected ? (
                <Rocket className="mr-1.5 h-3.5 w-3.5" />
              ) : null}
              {releaseSelected ? "Release" : isWorkflowCompleteReassign ? "Re-Assign" : "Assign"}
            </Button>
          </div>
        </div>
      ) : null}

      {expanded === "transfer" ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="grid gap-2 text-xs md:grid-cols-[auto_1fr] md:items-center">
            <div className="font-medium">Transfer {remainingPercent}% To</div>
            <Select value={transferTo || "__none__"} onValueChange={(value) => setTransferTo(value === "__none__" ? "" : value)}>
              <SelectTrigger className="h-9 text-xs" disabled={isLoadingUsers || transferMutation.isPending}>
                <SelectValue placeholder={isLoadingUsers ? "Loading..." : "Employee"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Employee</SelectItem>
                {assignableUsers
                  .filter((employee) => employee.employee_id !== task?.assigned_to)
                  .map((employee) => (
                    <SelectItem key={employee.employee_id} value={employee.employee_id}>
                      {formatAssigneeOption(employee)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea
              value={transferReason}
              onChange={(event) => setTransferReason(event.target.value)}
              rows={2}
              className="text-xs"
              disabled={transferMutation.isPending}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetTransferForm();
                setExpanded(null);
              }}
              disabled={transferMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => transferMutation.mutate()} disabled={transferDisabled}>
              {transferMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />}
              Transfer
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 border-t pt-3">
        <ReleaseDeliverablesPanel
          fixtureId={fixture.fixture_id}
          departmentId={departmentId}
          assignableUsers={twoDAssignableUsers}
          readOnly={readOnly}
          onStatusChange={setReleasePackageStatus}
        />
      </div>

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{fixture.fixture_no} Work Image</DialogTitle>
          </DialogHeader>
          {previewImage ? (
            <SafeImage src={previewImage} alt={`${fixture.fixture_no} proof preview`} className="max-h-[70vh] w-full rounded-md object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejectingTask)} onOpenChange={(open) => {
        if (!open) {
          setRejectingTask(null);
          setRejectionReason("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Fixture Submission</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Rejection reason"
              rows={4}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRejectingTask(null);
                  setRejectionReason("");
                }}
                disabled={reviewMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!rejectionReason.trim() || reviewMutation.isPending || !rejectingTask}
                onClick={() => {
                  if (rejectingTask && rejectionReason.trim()) {
                    reviewMutation.mutate({
                      reviewTask: rejectingTask,
                      action: "reject",
                      remarks: rejectionReason.trim(),
                    });
                  }
                }}
              >
                {reviewMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancellingTask)} onOpenChange={(open) => {
        if (!open && !cancelMutation.isPending) {
          setCancellingTask(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Task</DialogTitle>
            <DialogDescription>
              Cancel this assigned task and return fixture to Unassigned state?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancellingTask(null)}
              disabled={cancelMutation.isPending}
            >
              Keep Assignment
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!cancellingTask || cancelMutation.isPending}
              onClick={() => {
                if (cancellingTask) {
                  cancelMutation.mutate(cancellingTask);
                }
              }}
            >
              {cancelMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
              Cancel Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
