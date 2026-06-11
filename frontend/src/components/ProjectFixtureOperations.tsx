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
  completeOutsourcedFixture,
  fetchFixtureFullProgress,
  fetchRecentOutsourceSuppliers,
  bringFixtureInHouse,
  manipulateFixtureStage,
  outsourceFixture,
  reopenFixtureStage,
  releaseFixtureWorkflow,
  validateFixtureAssignment,
  type FixtureFullProgress,
  type FixtureRevisionType,
} from "@/api/designApi";
import { cancelTask as cancelTaskRequest, fetchVerificationTasks, transferTask, updateTask } from "@/api/taskApi";
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
import { analyticsQueryKeys, batchQueryKeys, projectQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/imageUrl";
import type { DesignFixtureOption, OutsourceStage, Priority, Task, User as AppUser } from "@/types";

const OPEN_TASK_STATUSES = new Set(["assigned", "in_progress", "on_hold", "under_review", "rework"]);
const ASSIGNMENT_BLOCKED_STATES = new Set(["VERIFICATION", "REWORK", "IN_PROGRESS", "ASSIGNED", "WORKFLOW_COMPLETE"]);
const RECENT_SUPPLIERS_STORAGE_KEY = "parc_recent_outsource_suppliers";
const OUTSOURCE_STAGE_OPTIONS: OutsourceStage[] = ["Concept", "3D", "2D"];

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

function compactWorkflowCode(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.replace(/\s+/g, "") : null;
}

function normalizeStageKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isReleaseStageName(value: string | null | undefined) {
  const normalized = normalizeStageKey(value);
  return normalized === "release" || normalized === "released";
}

function mergeRecentSupplierNames(...groups: Array<Array<string | null | undefined>>) {
  const seen = new Set<string>();
  const merged: string[] = [];

  groups.flat().forEach((supplier) => {
    const value = String(supplier || "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(value);
  });

  return merged.slice(0, 6);
}

function readRecentSupplierNames() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_SUPPLIERS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? mergeRecentSupplierNames(parsed) : [];
  } catch {
    return [];
  }
}

function saveRecentSupplierName(supplierName: string, current: string[] = []) {
  const next = mergeRecentSupplierNames([supplierName], current);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(RECENT_SUPPLIERS_STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

function getFixtureWorkflowCode(fixture: DesignFixtureOption) {
  return compactWorkflowCode(fixture.workflow_revision_code);
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
      status: "PENDING",
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

function fixtureStageStatusColor(status: string | null | undefined) {
  switch (status?.toUpperCase()) {
    case "IN_PROGRESS":
      return "border-sky-300 bg-sky-50 text-sky-800";
    case "PENDING":
      return "border-amber-300 bg-amber-50 text-amber-800";
    case "APPROVED":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "WORKFLOW_COMPLETE":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "REJECTED":
    case "REWORK":
      return "border-red-300 bg-red-50 text-red-800";
    case "VERIFICATION":
      return "border-violet-300 bg-violet-50 text-violet-800";
    case "UNASSIGNED":
      return "border-slate-300 bg-slate-50 text-slate-700";
    default:
      return "border-slate-300 bg-slate-50 text-slate-700";
  }
}

function getFixtureOutsourceStatus(fixture: DesignFixtureOption) {
  return fixture.outsource_status || (fixture.is_outsourced === true ? "outsourced" : null);
}

function canonicalOutsourceStageFromWorkflowStage(value: string | null | undefined): OutsourceStage | null {
  const normalized = normalizeStageKey(value);
  if (normalized === "concept" || normalized === "concept_stage") {
    return "Concept";
  }
  if (normalized === "3d" || normalized === "3d_finish" || normalized === "three_d" || normalized === "three_d_finish") {
    return "3D";
  }
  if (normalized === "2d" || normalized === "2d_finish" || normalized === "two_d" || normalized === "two_d_finish") {
    return "2D";
  }
  return null;
}

function isFixtureOutsourcePlanActive(fixture: DesignFixtureOption) {
  const status = getFixtureOutsourceStatus(fixture);
  return status === "outsourced";
}

function hasFixtureOutsourcePlan(fixture: DesignFixtureOption) {
  const status = getFixtureOutsourceStatus(fixture);
  return fixture.is_outsourced === true
    && status !== "brought_in_house"
    && (fixture.outsourced_stages || []).length > 0;
}

function isFixtureCurrentStageOutsourced(fixture: DesignFixtureOption) {
  if (fixture.is_workflow_complete === true || !hasFixtureOutsourcePlan(fixture)) {
    return false;
  }

  const currentStage = canonicalOutsourceStageFromWorkflowStage(getCurrentFixtureStageLabel(fixture));
  return Boolean(currentStage && fixture.outsourced_stages?.includes(currentStage));
}

function isFixtureActiveOutsourcedSection(fixture: DesignFixtureOption) {
  return isFixtureCurrentStageOutsourced(fixture);
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

function getCurrentFixtureStageLabel(fixture: DesignFixtureOption) {
  if (fixture.is_workflow_complete === true) {
    return "Release";
  }

  return fixture.workflow_stage_label || fixture.workflow_stage || "Pending";
}

function isDapStageName(value: string | null | undefined) {
  const normalized = normalizeStageKey(value);
  return normalized === "dap" || normalized === "d_a_p";
}

function getOutsourcedCurrentStatusLabel(fixture: DesignFixtureOption) {
  if (fixture.is_workflow_complete === true) {
    return "Released";
  }

  const status = getFixtureOutsourceStatus(fixture);
  const workflowStatus = fixtureStageStatusLabel(fixture.workflow_status || fixture.operational_state);
  if (status === "completed" && isDapStageName(getCurrentFixtureStageLabel(fixture))) {
    return `Supplier Complete / DAP ${workflowStatus}`;
  }

  if (status === "completed") {
    return `Supplier Complete / ${workflowStatus}`;
  }

  return workflowStatus;
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
  const activeAssigneeName = activeTask?.assignee
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
    description: "Delegated to an external party",
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
}: ProjectFixtureOperationsGridProps) {
  const { access, user } = useAuth();
  const { tasks, refreshTasks } = useTasks();
  const queryClient = useQueryClient();
  const assignableUsersQuery = useAssignableUsersQuery();
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [localRecentSupplierNames, setLocalRecentSupplierNames] = useState<string[]>(() => readRecentSupplierNames());
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    UNASSIGNED: true,
    ASSIGNED: true,
    IN_PROGRESS: true,
    OUTSOURCED: true,
    VERIFICATION: true,
    REWORK: true,
    WORKFLOW_COMPLETE: false,
  });

  const verificationQuery = useQuery({
    queryKey: taskQueryKeys.verificationQueue,
    queryFn: fetchVerificationTasks,
    enabled: Boolean(user?.employee_id && access.canViewVerifications),
  });

  const recentSuppliersQuery = useQuery({
    queryKey: ["design", "outsourcing", "suppliers", departmentId || "self"],
    queryFn: () => fetchRecentOutsourceSuppliers(departmentId || undefined),
    enabled: access.canAccessProjectFixtures && access.canChangeFixtureStage,
  });

  const recentSupplierNames = useMemo(
    () => mergeRecentSupplierNames(localRecentSupplierNames, recentSuppliersQuery.data ?? []),
    [localRecentSupplierNames, recentSuppliersQuery.data],
  );

  const rememberSupplierName = useCallback((supplierName: string) => {
    setLocalRecentSupplierNames((current) => saveRecentSupplierName(supplierName, current));
  }, []);

  const combinedTasks = useMemo(() => {
    const fixtureIds = new Set(fixtures.map((fixture) => fixture.fixture_id));
    const taskById = new Map<number, Task>();

    [...tasks, ...(verificationQuery.data ?? [])].forEach((task) => {
      if (task.fixture_id && fixtureIds.has(task.fixture_id)) {
        taskById.set(task.id, task);
      }
    });

    return [...taskById.values()];
  }, [fixtures, tasks, verificationQuery.data]);

  const fixtureTaskById = useMemo(() => {
    const map = new Map<string, Task | null>();
    fixtures.forEach((fixture) => {
      map.set(fixture.fixture_id, pickFixtureTask(fixture, combinedTasks));
    });
    return map;
  }, [combinedTasks, fixtures]);

  const operationalResolutionByFixtureId = useMemo(() => {
    const map = new Map<string, FixtureOperationalResolution>();
    fixtures.forEach((fixture) => {
      map.set(fixture.fixture_id, resolveFixtureOperationalState(fixture, fixtureTaskById.get(fixture.fixture_id) || null));
    });
    return map;
  }, [fixtureTaskById, fixtures]);

  const assignableFixtures = useMemo(
    () => fixtures.filter((fixture) => (
      !isFixtureActiveOutsourcedSection(fixture)
      && operationalResolutionByFixtureId.get(fixture.fixture_id)?.assignable === true
    )),
    [fixtures, operationalResolutionByFixtureId],
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
      const sectionFixtures = fixtures.filter((fixture) => {
        if (seen.has(fixture.fixture_id)) {
          return false;
        }

        const isActiveOutsourced = isFixtureActiveOutsourcedSection(fixture);
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
  }, [fixtureTaskById, fixtures, operationalResolutionByFixtureId]);

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
      queryClient.invalidateQueries({ queryKey: ["workflow"] }),
      queryClient.invalidateQueries({ queryKey: ["design", "outsourcing", "suppliers"] }),
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
      <div className="flex items-center justify-end">
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
      </div>

      {bulkPanelOpen ? (
        <BulkFixtureAssignmentPanel
          assignableFixtures={assignableFixtures}
          selectedFixtureIds={eligibleSelectedFixtureIds}
          projectId={projectId}
          departmentId={departmentId || undefined}
          assignableUsers={assignableUsersQuery.data ?? []}
          isLoadingUsers={assignableUsersQuery.isLoading}
          invalidateOperationalState={invalidateOperationalState}
          onCancel={() => setBulkPanelOpen(false)}
        />
      ) : null}

      <div className="space-y-3">
        {fixtureSections.map((section) => {
          const sectionStyle = FIXTURE_SECTION_STYLES[section.key];

          return (
            <Collapsible
              key={section.key}
              open={openSections[section.key] ?? true}
              onOpenChange={(open) => setOpenSections((current) => ({ ...current, [section.key]: open }))}
              className="overflow-hidden rounded-lg border bg-background"
              style={{ borderColor: sectionStyle.accent }}
            >
              <CollapsibleTrigger
                className="flex w-full items-center justify-between gap-3 border-l-4 px-3 py-2.5 text-left"
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
                    <span className="block text-sm font-semibold leading-tight">{section.label}</span>
                    <span className="block text-xs leading-snug opacity-90">{sectionStyle.description}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className="bg-white/55 font-semibold"
                    style={{ borderColor: sectionStyle.accent, color: sectionStyle.text }}
                  >
                    {section.fixtures.length} fixture{section.fixtures.length === 1 ? "" : "s"}
                  </Badge>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", openSections[section.key] ? "rotate-180" : "")} />
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t p-3">
                {section.fixtures.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No fixtures in this section.</p>
                ) : section.key === "OUTSOURCED" ? (
                  <OutsourcedFixturesTable
                    fixtures={section.fixtures}
                    fixtureTaskById={fixtureTaskById}
                    projectId={projectId}
                    departmentId={departmentId || undefined}
                    assignableUsers={assignableUsersQuery.data ?? []}
                    isLoadingUsers={assignableUsersQuery.isLoading}
                    invalidateOperationalState={invalidateOperationalState}
                    operationalResolutionByFixtureId={operationalResolutionByFixtureId}
                  />
                ) : (
                  <div className="space-y-2">
                    {section.fixtures.map((fixture) => (
                      <ProjectFixtureCard
                        key={fixture.fixture_id}
                        fixture={fixture}
                        task={fixtureTaskById.get(fixture.fixture_id) || null}
                        projectId={projectId}
                        departmentId={departmentId || undefined}
                        assignableUsers={assignableUsersQuery.data ?? []}
                        isLoadingUsers={assignableUsersQuery.isLoading}
                        invalidateOperationalState={invalidateOperationalState}
                        operationalResolution={operationalResolutionByFixtureId.get(fixture.fixture_id) || resolveFixtureOperationalState(fixture, fixtureTaskById.get(fixture.fixture_id) || null)}
                        recentSupplierNames={recentSupplierNames}
                        onSupplierUsed={rememberSupplierName}
                        selectable={bulkPanelOpen && assignableFixtureIds.has(fixture.fixture_id)}
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
  projectId: string;
  departmentId?: string;
  assignableUsers: Array<{ employee_id: string; name: string }>;
  isLoadingUsers: boolean;
  invalidateOperationalState: () => Promise<void>;
  operationalResolutionByFixtureId: Map<string, FixtureOperationalResolution>;
}

function OutsourcedFixturesTable({
  fixtures,
  fixtureTaskById,
  projectId,
  departmentId,
  assignableUsers,
  isLoadingUsers,
  invalidateOperationalState,
  operationalResolutionByFixtureId,
}: OutsourcedFixturesTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[980px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[130px]">Fixture No</TableHead>
            <TableHead className="min-w-[200px]">Fixture Name</TableHead>
            <TableHead className="min-w-[160px]">Supplier</TableHead>
            <TableHead className="min-w-[160px]">Outsourced Stages</TableHead>
            <TableHead className="min-w-[150px]">Current Stage</TableHead>
            <TableHead className="min-w-[170px]">Current Status</TableHead>
            <TableHead className="min-w-[130px]">Outsourced Date</TableHead>
            <TableHead className="min-w-[260px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fixtures.map((fixture) => (
            <OutsourcedFixtureRow
              key={fixture.fixture_id}
              fixture={fixture}
              projectId={projectId}
              departmentId={departmentId}
              assignableUsers={assignableUsers}
              isLoadingUsers={isLoadingUsers}
              invalidateOperationalState={invalidateOperationalState}
              operationalResolution={operationalResolutionByFixtureId.get(fixture.fixture_id) || resolveFixtureOperationalState(fixture, fixtureTaskById.get(fixture.fixture_id) || null)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface OutsourcedFixtureRowProps {
  fixture: DesignFixtureOption;
  projectId: string;
  departmentId?: string;
  assignableUsers: Array<{ employee_id: string; name: string }>;
  isLoadingUsers: boolean;
  invalidateOperationalState: () => Promise<void>;
  operationalResolution: FixtureOperationalResolution;
}

function OutsourcedFixtureRow({
  fixture,
  projectId,
  departmentId,
  assignableUsers,
  isLoadingUsers,
  invalidateOperationalState,
  operationalResolution,
}: OutsourcedFixtureRowProps) {
  const { access } = useAuth();
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [inHouseDialogOpen, setInHouseDialogOpen] = useState(false);
  const outsourceStatus = getFixtureOutsourceStatus(fixture);
  const currentStageOutsourced = isFixtureCurrentStageOutsourced(fixture);
  const supplierCompleted = outsourceStatus === "completed" && !currentStageOutsourced;
  const canToggleOutsourcing = access.canAccessProjectFixtures && access.canChangeFixtureStage;

  const completeMutation = useMutation({
    mutationFn: () => completeOutsourcedFixture(fixture.fixture_id, { department_id: departmentId }),
    onSuccess: async (updatedFixture) => {
      await invalidateOperationalState();
      setCompleteDialogOpen(false);
      toast({
        title: updatedFixture.workflow_marked_complete ? "Workflow completed" : "Outsourced stage completed",
        description: updatedFixture.workflow_marked_complete
          ? "The final outsourced workflow stage was completed."
          : "The fixture advanced to the next workflow stage.",
      });
    },
    onError: (error) => {
      toast({
        title: "Completion failed",
        description: error instanceof Error ? error.message : "Could not complete outsourced work",
        variant: "destructive",
      });
    },
  });

  const inHouseMutation = useMutation({
    mutationFn: () => bringFixtureInHouse(fixture.fixture_id, { department_id: departmentId }),
    onSuccess: async () => {
      await invalidateOperationalState();
      setInHouseDialogOpen(false);
      toast({
        title: "Fixture brought in-house",
        description: "Outsource history remains attached to the same fixture record.",
      });
    },
    onError: (error) => {
      toast({
        title: "Bring in-house failed",
        description: error instanceof Error ? error.message : "Could not bring fixture in-house",
        variant: "destructive",
      });
    },
  });

  const actionsDisabled = completeMutation.isPending || inHouseMutation.isPending;

  return (
    <>
      <TableRow>
        <TableCell className="align-top font-semibold">{fixture.fixture_no}</TableCell>
        <TableCell className="align-top">
          <div className="max-w-[260px] whitespace-normal text-xs leading-snug">{fixture.part_name || "Not named"}</div>
        </TableCell>
        <TableCell className="align-top">
          <div className="max-w-[220px] whitespace-normal text-xs font-medium">{fixture.vendor_name || "Not set"}</div>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex max-w-[220px] flex-wrap gap-1">
            {(fixture.outsourced_stages || []).length > 0 ? (
              fixture.outsourced_stages?.map((stage) => (
                <Badge key={stage} variant="outline" className="border-cyan-300 bg-cyan-50 text-[11px] text-cyan-800">
                  {stage}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">Not set</span>
            )}
          </div>
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
            {getCurrentFixtureStageLabel(fixture)}
          </Badge>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-col gap-1">
            <Badge variant="outline" className={cn("w-fit text-[11px] font-medium", fixtureStageStatusColor(fixture.workflow_status || fixture.operational_state))}>
              {getOutsourcedCurrentStatusLabel(fixture)}
            </Badge>
            {operationalResolution.activeAssigneeName ? (
              <span className="text-[11px] text-muted-foreground">{operationalResolution.activeAssigneeName}</span>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="align-top text-xs text-muted-foreground">
          {formatDisplayDate(fixture.outsourced_at)}
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={supplierCompleted || !canToggleOutsourcing || actionsDisabled}
              onClick={() => setCompleteDialogOpen(true)}
            >
              {completeMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckSquare className="mr-1 h-3 w-3" />}
              {supplierCompleted ? "Completed" : "Mark Completed"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={!canToggleOutsourcing || actionsDisabled}
              onClick={() => setInHouseDialogOpen(true)}
            >
              {inHouseMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Factory className="mr-1 h-3 w-3" />}
              Bring In-House
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <Dialog open={completeDialogOpen} onOpenChange={(open) => {
        if (!open && !completeMutation.isPending) {
          setCompleteDialogOpen(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Outsourced Work Completed</DialogTitle>
            <DialogDescription>
              Confirm completion for the current outsourced stage, {getCurrentFixtureStageLabel(fixture)}, from {fixture.vendor_name || "supplier"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCompleteDialogOpen(false)}
              disabled={completeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={completeMutation.isPending}
              onClick={() => completeMutation.mutate()}
            >
              {completeMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckSquare className="mr-1.5 h-4 w-4" />}
              Mark Completed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inHouseDialogOpen} onOpenChange={(open) => {
        if (!open && !inHouseMutation.isPending) {
          setInHouseDialogOpen(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bring In-House</DialogTitle>
            <DialogDescription>
              Bring {fixture.fixture_no} back in-house?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInHouseDialogOpen(false)}
              disabled={inHouseMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={inHouseMutation.isPending}
              onClick={() => inHouseMutation.mutate()}
            >
              {inHouseMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Factory className="mr-1.5 h-4 w-4" />}
              Bring In-House
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface OutsourcedDapAssignmentPanelProps {
  fixture: DesignFixtureOption;
  projectId: string;
  departmentId?: string;
  assignableUsers: Array<{ employee_id: string; name: string }>;
  isLoadingUsers: boolean;
  invalidateOperationalState: () => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}

function OutsourcedDapAssignmentPanel({
  fixture,
  projectId,
  departmentId,
  assignableUsers,
  isLoadingUsers,
  invalidateOperationalState,
  onDone,
  onCancel,
}: OutsourcedDapAssignmentPanelProps) {
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("high");
  const [reasonType, setReasonType] = useState<FixtureRevisionType | "">("");

  const progressQuery = useQuery({
    queryKey: ["workflow", "progress", departmentId || "self", fixture.fixture_id],
    queryFn: () => fetchFixtureFullProgress(fixture.fixture_id, departmentId),
  });

  const validationQuery = useQuery({
    queryKey: ["workflow", "validate", departmentId || "self", fixture.fixture_id],
    queryFn: () => validateFixtureAssignment(fixture.fixture_id, departmentId),
    enabled: false,
  });

  const progress = progressQuery.data;
  const currentProgressStage = useMemo(() => getCurrentProgressStage(progress), [progress]);
  const dapStage = useMemo(
    () => progress?.stages?.find((stage) => isDapStageName(stage.stage_name)) || null,
    [progress],
  );
  const workflowChanged = Boolean(dapStage && currentProgressStage && dapStage.stage_name !== currentProgressStage.stage_name);
  const dapApproved = String(dapStage?.status || "").toUpperCase() === "APPROVED";
  const workflowTarget = dapStage?.stage_name || "";
  const assignmentBlockedReason = !workflowChanged ? validationQuery.data?.reason || null : null;
  const refetchValidation = validationQuery.refetch;

  useEffect(() => {
    if (!dapStage || workflowChanged || dapApproved) {
      return;
    }

    void refetchValidation();
  }, [dapApproved, dapStage?.stage_name, dapStage?.status, refetchValidation, workflowChanged]);

  const assignDapMutation = useMutation({
    mutationFn: async () => {
      if (!dapStage) {
        throw new Error("DAP stage is not configured for this workflow");
      }

      if (dapApproved) {
        throw new Error("DAP is already approved");
      }

      if (!assignedTo || !deadline) {
        throw new Error("Assignee and deadline are required");
      }

      if (workflowChanged) {
        if (!reasonType) {
          throw new Error("Reason Type is required when workflow is changed");
        }

        if (reasonType === "MANUAL_OVERRIDE") {
          await manipulateFixtureStage({
            fixture_id: fixture.fixture_id,
            department_id: departmentId,
            target_stage_name: workflowTarget,
            target_status: "PENDING",
            reason_type: "MANUAL_OVERRIDE",
            revision_type: "MANUAL_OVERRIDE",
            revision_reason: "Manual override selected during outsourced DAP assignment",
            remarks: "Manual override selected during outsourced DAP assignment",
          });
        } else {
          await reopenFixtureStage({
            fixture_id: fixture.fixture_id,
            department_id: departmentId,
            target_stage_name: workflowTarget,
            revision_type: reasonType,
          });
        }
      } else {
        const validation = await validateFixtureAssignment(fixture.fixture_id, departmentId);
        if (validation.canAssign !== true) {
          throw new Error(validation.reason || "DAP is not currently assignable");
        }
      }

      await createDesignTask({
        department_id: departmentId,
        project_id: projectId,
        fixture_id: fixture.fixture_id,
        description: fixture.part_name || fixture.fixture_no,
        assigned_to: assignedTo,
        assignee_ids: [assignedTo],
        priority,
        deadline: normalizeDeadlineToEndOfDayIso(deadline),
      });
    },
    onSuccess: async () => {
      await invalidateOperationalState();
      onDone();
      toast({
        title: "DAP assigned",
        description: "The existing design assignment flow created the internal DAP task.",
      });
    },
    onError: (error) => {
      toast({
        title: "DAP assignment failed",
        description: error instanceof Error ? error.message : "Could not assign DAP",
        variant: "destructive",
      });
    },
  });

  const assignmentDisabled = !assignedTo
    || !deadline
    || !workflowTarget
    || !dapStage
    || dapApproved
    || progressQuery.isLoading
    || assignDapMutation.isPending
    || (workflowChanged && !reasonType)
    || (!workflowChanged && (validationQuery.isLoading || validationQuery.data?.canAssign !== true));

  return (
    <div className="rounded-md border border-slate-200 bg-background p-3">
      <div className="grid gap-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Employee</Label>
          <Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}>
            <SelectTrigger className="h-9 bg-white text-xs" disabled={isLoadingUsers || assignDapMutation.isPending}>
              <SelectValue placeholder={isLoadingUsers ? "Loading..." : "Employee"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Employee</SelectItem>
              {assignableUsers.map((employee) => (
                <SelectItem key={employee.employee_id} value={employee.employee_id}>
                  {formatEmployeeDisplay(employee)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Deadline</Label>
          <DateOnlyDeadlinePicker value={deadline} onChange={setDeadline} disabled={assignDapMutation.isPending} />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Priority</Label>
          <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
            <SelectTrigger className="h-9 bg-white text-xs" disabled={assignDapMutation.isPending}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Workflow</Label>
          <div className="flex h-9 items-center rounded-md border bg-slate-50 px-3 text-xs">
            {progressQuery.isLoading ? (
              <span className="text-muted-foreground">Loading...</span>
            ) : dapStage ? (
              <span className="truncate">{getStageWorkflowCode(dapStage)} - {fixtureStageStatusLabel(dapStage.status)}</span>
            ) : (
              <span className="text-red-600">DAP unavailable</span>
            )}
          </div>
        </div>
      </div>

      {workflowChanged ? (
        <div className="mt-2 max-w-sm space-y-1">
          <Label className="text-xs">Reason Type</Label>
          <Select value={reasonType || "__none__"} onValueChange={(value) => setReasonType(value === "__none__" ? "" : value as FixtureRevisionType)}>
            <SelectTrigger className="h-9 bg-white text-xs" disabled={assignDapMutation.isPending}>
              <SelectValue placeholder="Reason Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Reason Type</SelectItem>
              {revisionReasonOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {assignmentBlockedReason ? (
        <p className="mt-2 text-xs text-red-600">{assignmentBlockedReason}</p>
      ) : null}
      {dapApproved ? (
        <p className="mt-2 text-xs text-emerald-700">DAP is already approved.</p>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={assignDapMutation.isPending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => assignDapMutation.mutate()} disabled={assignmentDisabled}>
          {assignDapMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Assign DAP
        </Button>
      </div>
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
  departmentId?: string;
  assignableUsers: Array<{ employee_id: string; name: string }>;
  isLoadingUsers: boolean;
  invalidateOperationalState: () => Promise<void>;
  onCancel: () => void;
}

function BulkFixtureAssignmentPanel({
  assignableFixtures,
  selectedFixtureIds,
  projectId,
  departmentId,
  assignableUsers,
  isLoadingUsers,
  invalidateOperationalState,
  onCancel,
}: BulkFixtureAssignmentPanelProps) {
  const { access } = useAuth();
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("high");
  const [workflowTarget, setWorkflowTarget] = useState("");
  const [reasonType, setReasonType] = useState<FixtureRevisionType | "">("");
  const selectedFixtureCount = selectedFixtureIds.length;
  const scope: "all_unassigned" | "selected" = selectedFixtureCount > 0 ? "selected" : "all_unassigned";

  const targetFixtures = useMemo(() => {
    if (scope === "selected") {
      const selected = new Set(selectedFixtureIds);
      return assignableFixtures.filter((fixture) => selected.has(fixture.fixture_id));
    }

    return assignableFixtures;
  }, [assignableFixtures, scope, selectedFixtureIds]);

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
  const canSubmitWorkflowAction = releaseSelected
    ? access.canChangeFixtureStage
    : access.canAssignTasks && access.canCreateTasks && access.canChangeFixtureStage;
  const workflowChangeAllowed = !workflowChanged || reasonType === "MANUAL_OVERRIDE" || selectedWorkflowStage?.status === "APPROVED";
  const progressLoading = progressQueries.some((query) => query.isLoading);
  const selectedScopeEmpty = scope === "selected" && targetFixtures.length === 0;
  const requiresReasonType = workflowChanged && !releaseSelected;

  const resetForm = () => {
    setAssignedTo("");
    setDeadline("");
    setPriority("high");
    setWorkflowTarget("");
    setReasonType("");
  };

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

        if (releaseSelected) {
          await releaseFixtureWorkflow({
            fixture_id: fixture.fixture_id,
            department_id: departmentId,
          });
          assignedCount += 1;
          continue;
        }

        await createDesignTask({
          department_id: departmentId,
          project_id: projectId,
          fixture_id: fixture.fixture_id,
          description: fixture.part_name || fixture.fixture_no,
          assigned_to: assignedTo,
          assignee_ids: [assignedTo],
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
    || bulkAssignMutation.isPending;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="grid gap-2 lg:grid-cols-4">
        {!releaseSelected ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Employee</Label>
              <Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}>
                <SelectTrigger className="h-9 bg-white text-xs" disabled={isLoadingUsers || bulkAssignMutation.isPending}>
                  <SelectValue placeholder={isLoadingUsers ? "Loading..." : "Employee"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Employee</SelectItem>
                  {assignableUsers.map((employee) => (
                    <SelectItem key={employee.employee_id} value={employee.employee_id}>
                      {formatEmployeeDisplay(employee)}
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
  isLoadingUsers: boolean;
  invalidateOperationalState: () => Promise<void>;
  operationalResolution: FixtureOperationalResolution;
  recentSupplierNames: string[];
  onSupplierUsed: (supplierName: string) => void;
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
  isLoadingUsers,
  invalidateOperationalState,
  operationalResolution,
  recentSupplierNames,
  onSupplierUsed,
  selectable = false,
  selected = false,
  onSelectedChange,
}: ProjectFixtureCardProps) {
  const { access, user } = useAuth();
  const [expanded, setExpanded] = useState<"assign" | "transfer" | null>(null);
  const [assignedTo, setAssignedTo] = useState("");
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
  const [outsourceDialogOpen, setOutsourceDialogOpen] = useState(false);
  const [inHouseDialogOpen, setInHouseDialogOpen] = useState(false);
  const [supplierName, setSupplierName] = useState(fixture.vendor_name || "");
  const [selectedOutsourceStages, setSelectedOutsourceStages] = useState<OutsourceStage[]>([]);
  const [outsourceValidationMessage, setOutsourceValidationMessage] = useState<string | null>(null);

  const canDeployDesignTask = access.canAssignTasks && access.canCreateTasks && access.canChangeFixtureStage;
  const fixtureAtReleaseStage = isReleaseStageName(fixture.workflow_stage || fixture.workflow_stage_label);
  const completedPercent = Math.max(0, Math.min(100, Number(task?.completion_percent ?? 0)));
  const remainingPercent = Math.max(0, 100 - completedPercent);
  const canTransferTask = Boolean(
    task
    && remainingPercent > 0
    && (access.canTransferTasks || access.canAssignTasks)
    && !["closed", "cancelled", "under_review"].includes(task.status),
  );
  const canReviewTask = Boolean(
    task
    && task.status === "under_review"
    && task.verification_status === "pending"
    && (access.canApproveCompletedTasks || access.canApproveQuality),
  ) && (!isTaskAssignedToCurrentUser(task, user?.employee_id) || access.canSelfApprove);

  const progressQuery = useQuery({
    queryKey: ["workflow", "progress", departmentId || "self", fixture.fixture_id],
    queryFn: () => fetchFixtureFullProgress(fixture.fixture_id, departmentId),
    enabled: expanded === "assign",
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

  useEffect(() => {
    if (!outsourceDialogOpen) {
      setSupplierName(fixture.vendor_name || "");
      setSelectedOutsourceStages([]);
      setOutsourceValidationMessage(null);
    }
  }, [fixture.vendor_name, outsourceDialogOpen]);

  const selectedWorkflowStage = workflowOptions.find((stage) => stage.stage_name === workflowTarget) || null;
  const releaseSelected = isReleaseStageName(selectedWorkflowStage?.stage_name || workflowTarget);
  const canOpenWorkflowAction = isWorkflowCompleteReassign
    ? canDeployDesignTask
    : fixtureAtReleaseStage
      ? access.canChangeFixtureStage
      : canDeployDesignTask;
  const canSubmitWorkflowAction = releaseSelected ? access.canChangeFixtureStage : canDeployDesignTask;
  const workflowChanged = Boolean(workflowTarget && workflowTarget !== currentProgressStage?.stage_name);
  const canAssignCurrent = validationQuery.data?.canAssign === true;
  const assignmentBlockedReason = validationQuery.data?.reason || null;
  const workflowChangeAllowed = workflowChanged && Boolean(selectedWorkflowStage);
  const canSubmitAssignment = releaseSelected || (workflowChanged ? workflowChangeAllowed : canAssignCurrent);
  const requiresReasonType = workflowChanged && !releaseSelected && !isWorkflowCompleteReassign;

  const proofImage = getProofImage(task);
  const outsourceStatus = getFixtureOutsourceStatus(fixture);
  const isOutsourceCompleted = outsourceStatus === "completed";
  const hasActiveOutsourcePlan = isFixtureOutsourcePlanActive(fixture);
  const isOutsourced = hasFixtureOutsourcePlan(fixture);
  const isSubmittedForVerification = canonicalOperationalState === "VERIFICATION";
  const isAssigned = canonicalOperationalState !== "UNASSIGNED" && canonicalOperationalState !== "WORKFLOW_COMPLETE";
  const workflowCode = getFixtureWorkflowCode(fixture);
  const releaseDateLabel = formatDisplayDate(getFixtureReleaseDate(fixture), "Not recorded");
  const releasedByLabel = getFixtureReleasedBy(fixture);
  const operationalStatus = fixtureStageStatusLabel(canonicalOperationalState);
  const canCancelTask = canCancelFixtureOperationalTask(task, canonicalOperationalState, user, access);
  const canToggleOutsourcing = access.canAccessProjectFixtures && access.canChangeFixtureStage;

  const resetAssignForm = () => {
    setAssignedTo("");
    setDeadline("");
    setPriority("high");
    setWorkflowTarget("");
    setReasonType("");
  };

  const resetTransferForm = () => {
    setTransferTo("");
    setTransferReason("");
  };

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
    mutationFn: async () => {
      if (releaseSelected) {
        await releaseFixtureWorkflow({
          fixture_id: fixture.fixture_id,
          department_id: departmentId,
        });
        return;
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
        assigned_to: assignedTo,
        assignee_ids: [assignedTo],
        priority,
        deadline: normalizeDeadlineToEndOfDayIso(deadline),
      });
    },
    onSuccess: async () => {
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

  const outsourceMutation = useMutation({
    mutationFn: async (
      variables:
        | { action: "outsource"; supplierName: string; stages: OutsourceStage[] }
        | { action: "bring_in_house" },
    ) => {
      if (variables.action === "outsource") {
        await outsourceFixture(fixture.fixture_id, {
          department_id: departmentId,
          supplier_name: variables.supplierName,
          outsourced_stages: variables.stages,
        });
        return;
      }

      await bringFixtureInHouse(fixture.fixture_id, {
        department_id: departmentId,
      });
    },
    onSuccess: async (_, variables) => {
      if (variables.action === "outsource") {
        onSupplierUsed(variables.supplierName);
      }
      await invalidateOperationalState();
      setExpanded(null);
      setOutsourceDialogOpen(false);
      setInHouseDialogOpen(false);
      setSelectedOutsourceStages([]);
      setOutsourceValidationMessage(null);
      toast({
        title: variables.action === "outsource" ? "Fixture outsourced" : "Fixture brought in-house",
        description: "Fixture history, task history, reports, and analytics continue to use the same fixture record.",
      });
    },
    onError: (error) => {
      toast({
        title: hasActiveOutsourcePlan ? "Bring in-house failed" : "Outsource failed",
        description: error instanceof Error ? error.message : "Could not update fixture outsourcing state",
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
    || assignMutation.isPending;

  const transferDisabled = !task
    || !transferTo
    || remainingPercent <= 0
    || transferMutation.isPending;
  const trimmedSupplierName = supplierName.trim();
  const supplierOptions = mergeRecentSupplierNames(recentSupplierNames, [fixture.vendor_name]);
  const allOutsourceStagesSelected = selectedOutsourceStages.length === OUTSOURCE_STAGE_OPTIONS.length;

  const toggleOutsourceStage = (stage: OutsourceStage, checked: boolean) => {
    setOutsourceValidationMessage(null);
    setSelectedOutsourceStages((current) => (
      checked
        ? Array.from(new Set([...current, stage]))
        : current.filter((item) => item !== stage)
    ));
  };

  const setAllOutsourceStages = (checked: boolean) => {
    setOutsourceValidationMessage(null);
    setSelectedOutsourceStages(checked ? [...OUTSOURCE_STAGE_OPTIONS] : []);
  };

  const confirmOutsource = () => {
    if (!trimmedSupplierName) {
      setOutsourceValidationMessage("Supplier name is required.");
      return;
    }

    if (selectedOutsourceStages.length === 0) {
      setOutsourceValidationMessage("Select at least one outsourced stage.");
      return;
    }

    outsourceMutation.mutate({
      action: "outsource",
      supplierName: trimmedSupplierName,
      stages: selectedOutsourceStages,
    });
  };

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
            {isOutsourced ? (
              <Badge
                variant="outline"
                className={cn(
                  "gap-0.5 text-xs font-semibold",
                  isOutsourceCompleted
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-300 bg-slate-50 text-slate-700",
                )}
              >
                <Factory className="h-3 w-3" />
                {isOutsourceCompleted ? "Outsource Completed" : "Outsourced"}
              </Badge>
            ) : null}
            {fixture.outsourced_stages && fixture.outsourced_stages.length > 0 ? (
              <Badge variant="outline" className="max-w-[12rem] truncate border-cyan-300 bg-cyan-50 text-xs font-medium text-cyan-800">
                {fixture.outsourced_stages.join(", ")}
              </Badge>
            ) : null}
            <Badge variant="outline" className={cn("text-xs font-medium", fixtureStageStatusColor(canonicalOperationalState))}>
              {operationalStatus}
            </Badge>
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
            {isOutsourceCompleted ? (
              <Badge variant="outline" className="h-7 gap-1 border-emerald-300 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-700">
                <CheckSquare className="h-3 w-3" />
                Completed
              </Badge>
            ) : canToggleOutsourcing ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={outsourceMutation.isPending}
                onClick={() => {
                  if (hasActiveOutsourcePlan) {
                    setInHouseDialogOpen(true);
                  } else {
                    setSupplierName(fixture.vendor_name || "");
                    setSelectedOutsourceStages(fixture.outsourced_stages || []);
                    setOutsourceValidationMessage(null);
                    setOutsourceDialogOpen(true);
                  }
                }}
              >
                {outsourceMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Factory className="mr-1 h-3 w-3" />}
                {hasActiveOutsourcePlan ? "Bring In-House" : "Outsource"}
              </Button>
            ) : null}
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
          <div>
            <p className="font-semibold text-sm leading-tight">{fixture.fixture_no}</p>
            <p className="break-words text-xs text-muted-foreground">{fixture.part_name}</p>
          </div>

          {!releaseSelected ? (
            <div className="grid gap-2 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Assignee</Label>
                <Select value={assignedTo || "__none__"} onValueChange={(value) => setAssignedTo(value === "__none__" ? "" : value)}>
                  <SelectTrigger className="h-9 text-xs" disabled={isLoadingUsers || assignMutation.isPending}>
                    <SelectValue placeholder={isLoadingUsers ? "Loading..." : "Assignee"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Assignee</SelectItem>
                    {assignableUsers.map((employee) => (
                      <SelectItem key={employee.employee_id} value={employee.employee_id}>
                        {formatEmployeeDisplay(employee)}
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
                      {formatEmployeeDisplay(employee)}
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

      <Dialog open={outsourceDialogOpen} onOpenChange={(open) => {
        if (!open && !outsourceMutation.isPending) {
          setOutsourceDialogOpen(false);
          setSupplierName(fixture.vendor_name || "");
          setSelectedOutsourceStages([]);
          setOutsourceValidationMessage(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Outsource Fixture</DialogTitle>
            <DialogDescription>
              {fixture.fixture_no}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`supplier-${fixture.fixture_id}`} className="text-xs">Supplier Name</Label>
              <Input
                id={`supplier-${fixture.fixture_id}`}
                value={supplierName}
                onChange={(event) => {
                  setSupplierName(event.target.value);
                  setOutsourceValidationMessage(null);
                }}
                disabled={outsourceMutation.isPending}
                autoFocus
              />
            </div>
            {supplierOptions.length > 0 ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Recent Suppliers</Label>
                <div className="flex flex-wrap gap-1.5">
                  {supplierOptions.map((supplier) => (
                    <Button
                      key={supplier}
                      type="button"
                      size="sm"
                      variant={supplierName.trim().toLowerCase() === supplier.toLowerCase() ? "secondary" : "outline"}
                      className="h-7 max-w-full px-2 text-[11px]"
                      disabled={outsourceMutation.isPending}
                      onClick={() => {
                        setSupplierName(supplier);
                        setOutsourceValidationMessage(null);
                      }}
                    >
                      <span className="truncate">{supplier}</span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label className="text-xs">Outsourced Stages</Label>
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Checkbox
                  checked={allOutsourceStagesSelected}
                  disabled={outsourceMutation.isPending}
                  onCheckedChange={(checked) => setAllOutsourceStages(checked === true)}
                />
                <span className="font-medium">Select All</span>
              </label>
              <div className="grid gap-2 sm:grid-cols-3">
                {OUTSOURCE_STAGE_OPTIONS.map((stage) => (
                  <label key={stage} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox
                      checked={selectedOutsourceStages.includes(stage)}
                      disabled={outsourceMutation.isPending}
                      onCheckedChange={(checked) => toggleOutsourceStage(stage, checked === true)}
                    />
                    <span>{stage}</span>
                  </label>
                ))}
              </div>
            </div>
            {outsourceValidationMessage ? (
              <p className="text-sm font-medium text-red-600">{outsourceValidationMessage}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOutsourceDialogOpen(false)}
              disabled={outsourceMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={outsourceMutation.isPending}
              onClick={confirmOutsource}
            >
              {outsourceMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Factory className="mr-1.5 h-4 w-4" />}
              Confirm Outsource
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inHouseDialogOpen} onOpenChange={(open) => {
        if (!open && !outsourceMutation.isPending) {
          setInHouseDialogOpen(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bring In-House</DialogTitle>
            <DialogDescription>
              Bring this fixture back in-house?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInHouseDialogOpen(false)}
              disabled={outsourceMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={outsourceMutation.isPending}
              onClick={() => outsourceMutation.mutate({ action: "bring_in_house" })}
            >
              {outsourceMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Factory className="mr-1.5 h-4 w-4" />}
              Bring In-House
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
