import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ControlWorkflowSection } from "@/components/ControlWorkflowSection";
import type { ControlDesignCapabilities, ControlProjectWorkflow, ControlWorkflowRevision, ControlWorkflowStage } from "@/api/controlWorkflowApi";
import type { ProjectDashboardSummary } from "@/types";

const controlApi = vi.hoisted(() => ({
  approveControlWorkflowRevision: vi.fn(),
  approveControlWorkflowStage: vi.fn(),
  fetchControlDesignAssignableUsers: vi.fn(),
  createControlProjectWorkflow: vi.fn(),
  fetchControlPendingApprovals: vi.fn(),
  fetchControlProjectWorkflow: vi.fn(),
  fetchControlRevisionQueue: vi.fn(),
  fetchControlSubDepartments: vi.fn(),
  fetchControlWorkflowTemplate: vi.fn(),
  markControlWorkflowDispatched: vi.fn(),
  markControlWorkflowRevisionChangesRequired: vi.fn(),
  markControlWorkflowStagePreCompleted: vi.fn(),
  markControlWorkflowStageRevisionRequired: vi.fn(),
  overrideUnlockControlWorkflowStage: vi.fn(),
  skipControlWorkflowStageByOverride: vi.fn(),
  raiseControlWorkflowRevision: vi.fn(),
  reassignControlProjectWorkflowOwner: vi.fn(),
  startControlWorkflowRevision: vi.fn(),
  startControlWorkflowStage: vi.fn(),
  submitControlWorkflowRevision: vi.fn(),
  submitControlWorkflowStage: vi.fn(),
  updateControlWorkflowDocumentPath: vi.fn(),
}));

let mockAuth: {
  access: Record<string, boolean>;
  user: Record<string, unknown>;
};
let sectionCapabilities: ControlDesignCapabilities;

vi.mock("@/api/controlWorkflowApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/controlWorkflowApi")>();
  return {
    ...actual,
    approveControlWorkflowRevision: (...args: unknown[]) => controlApi.approveControlWorkflowRevision(...args),
    approveControlWorkflowStage: (...args: unknown[]) => controlApi.approveControlWorkflowStage(...args),
    fetchControlDesignAssignableUsers: (...args: unknown[]) => controlApi.fetchControlDesignAssignableUsers(...args),
    createControlProjectWorkflow: (...args: unknown[]) => controlApi.createControlProjectWorkflow(...args),
    fetchControlPendingApprovals: (...args: unknown[]) => controlApi.fetchControlPendingApprovals(...args),
    fetchControlProjectWorkflow: (...args: unknown[]) => controlApi.fetchControlProjectWorkflow(...args),
    fetchControlRevisionQueue: (...args: unknown[]) => controlApi.fetchControlRevisionQueue(...args),
    fetchControlSubDepartments: (...args: unknown[]) => controlApi.fetchControlSubDepartments(...args),
    fetchControlWorkflowTemplate: (...args: unknown[]) => controlApi.fetchControlWorkflowTemplate(...args),
    markControlWorkflowDispatched: (...args: unknown[]) => controlApi.markControlWorkflowDispatched(...args),
    markControlWorkflowRevisionChangesRequired: (...args: unknown[]) => controlApi.markControlWorkflowRevisionChangesRequired(...args),
    markControlWorkflowStagePreCompleted: (...args: unknown[]) => controlApi.markControlWorkflowStagePreCompleted(...args),
    markControlWorkflowStageRevisionRequired: (...args: unknown[]) => controlApi.markControlWorkflowStageRevisionRequired(...args),
    overrideUnlockControlWorkflowStage: (...args: unknown[]) => controlApi.overrideUnlockControlWorkflowStage(...args),
    skipControlWorkflowStageByOverride: (...args: unknown[]) => controlApi.skipControlWorkflowStageByOverride(...args),
    raiseControlWorkflowRevision: (...args: unknown[]) => controlApi.raiseControlWorkflowRevision(...args),
    reassignControlProjectWorkflowOwner: (...args: unknown[]) => controlApi.reassignControlProjectWorkflowOwner(...args),
    startControlWorkflowRevision: (...args: unknown[]) => controlApi.startControlWorkflowRevision(...args),
    startControlWorkflowStage: (...args: unknown[]) => controlApi.startControlWorkflowStage(...args),
    submitControlWorkflowRevision: (...args: unknown[]) => controlApi.submitControlWorkflowRevision(...args),
    submitControlWorkflowStage: (...args: unknown[]) => controlApi.submitControlWorkflowStage(...args),
    updateControlWorkflowDocumentPath: (...args: unknown[]) => controlApi.updateControlWorkflowDocumentPath(...args),
  };
});

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p className="sr-only">{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: ReactNode;
    value: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <input
      aria-label="Confirm history record"
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

function buildCapabilities(overrides: Partial<ControlDesignCapabilities> = {}): ControlDesignCapabilities {
  return {
    canViewWorkspace: true,
    canViewAssignedProjects: true,
    canViewAllProjects: false,
    canCreateProject: false,
    canEditProject: false,
    canAssignProject: false,
    canReassignProject: false,
    canCancelProject: false,
    canStartStage: true,
    canSubmitStage: true,
    canUpdatePath: true,
    canReview: false,
    canApprove: false,
    canRequestChanges: false,
    canRaiseRevision: false,
    canExecuteRevision: true,
    canReviewRevision: false,
    canMarkPreCompleted: false,
    canOverrideUnlock: false,
    canSkipStage: false,
    canMarkDispatched: false,
    canReopenAfterDispatch: false,
    canViewAudit: false,
    canViewReports: false,
    ...overrides,
  };
}

const project = {
  project_id: "project-1",
  project_no: "PARC-001",
  project_name: "Press Line",
  customer_name: "ACME",
  department_id: "control",
  department_name: "Control",
  project_status: "active",
  completion_percent: 0,
  total_fixtures: 0,
  total_tasks: 0,
  pending_tasks: 0,
  active_tasks: 0,
  completed_tasks: 0,
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
} as ProjectDashboardSummary;

const now = "2026-07-08T10:00:00.000Z";

function revision(overrides: Partial<ControlWorkflowRevision> = {}): ControlWorkflowRevision {
  return {
    id: overrides.id || "revision-1",
    workflow_stage_id: overrides.workflow_stage_id || "stage-4",
    workflow_id: "workflow-1",
    revision_reason: "Internal Correction",
    description: "Update drawing references",
    due_date: "2026-07-10T10:00:00.000Z",
    priority: "medium",
    affected_stage_ids: [],
    status: "not_started",
    raised_by: "EMP-LEAD",
    raised_by_name: "Lead User",
    assigned_to: "EMP-OWNER",
    assigned_to_name: "Owner User",
    remarks: null,
    created_at: now,
    updated_at: now,
    project_no: "PARC-001",
    project_name: "Press Line",
    stage_name: "WBS Addition",
    sub_department_name: "Control Design",
    ...overrides,
  };
}

function stage(overrides: Partial<ControlWorkflowStage>): ControlWorkflowStage {
  return {
    id: overrides.id || "stage-1",
    workflow_id: "workflow-1",
    template_stage_id: null,
    stage_name: overrides.stage_name || "CO Creation",
    sequence_order: overrides.sequence_order || 1,
    is_required: true,
    status: overrides.status || "locked",
    current_document_path: overrides.current_document_path || null,
    started_at: null,
    submitted_at: null,
    approved_at: null,
    approved_by: null,
    approved_by_name: null,
    due_date: null,
    remarks: null,
    revision_count: overrides.revision_count || 0,
    created_at: now,
    updated_at: now,
    submissions: overrides.submissions || [],
    revisions: overrides.revisions || [],
    document_history: [],
    override_history: [],
    ...overrides,
  };
}

function workflow(): ControlProjectWorkflow {
  const stages = [
    stage({ id: "stage-1", stage_name: "CO Creation", sequence_order: 1, status: "in_progress", current_document_path: "\\\\server\\control\\co.xlsx", started_at: now }),
    stage({ id: "stage-2", stage_name: "ERP Budget Approval", sequence_order: 2, status: "locked" }),
    stage({
      id: "stage-3",
      stage_name: "CO Release",
      sequence_order: 3,
      status: "submitted_for_approval",
      submitted_at: now,
      submissions: [{
        id: "submission-1",
        workflow_stage_id: "stage-3",
        workflow_id: "workflow-1",
        submitted_by: "EMP-OWNER",
        submitted_by_name: "Owner User",
        submitted_document_path: "\\\\server\\control\\release.pdf",
        remarks: "Ready",
        status: "pending",
        reviewed_by: null,
        reviewed_by_name: null,
        reviewed_at: null,
        review_remarks: null,
        created_at: now,
        updated_at: now,
      }],
    }),
    stage({ id: "stage-4", stage_name: "WBS Addition", sequence_order: 4, status: "revision_required", revision_count: 1, revisions: [revision()] }),
    stage({ id: "stage-5", stage_name: "I/O List Preparation", sequence_order: 5, status: "approved", approved_at: now }),
    stage({ id: "stage-6", stage_name: "E-Plan Drawing Release", sequence_order: 6, status: "pre_completed", approved_at: now }),
    stage({ id: "stage-7", stage_name: "Panel Material Issue", sequence_order: 7, status: "skipped_by_override" }),
    stage({ id: "stage-8", stage_name: "Field Material Preparation", sequence_order: 8, status: "locked" }),
    stage({ id: "stage-9", stage_name: "Manual Preparation", sequence_order: 9, status: "locked" }),
  ];

  return {
    id: "workflow-1",
    project_id: "project-1",
    project_no: "PARC-001",
    project_name: "Press Line",
    customer_name: "ACME",
    project_status: "active",
    dispatch_status: "Not dispatched",
    department_id: "control",
    department_name: "Control",
    sub_department_id: "sub-control-design",
    sub_department_name: "Control Design",
    template_id: "template-control-design",
    template_name: "Control Design",
    assigned_user_id: "EMP-OWNER",
    assigned_user_name: "Owner User",
    assigned_by: "EMP-LEAD",
    assigned_by_name: "Lead User",
    current_stage_id: "stage-1",
    status: "active",
    started_at: now,
    completed_at: null,
    stages,
    progress: {
      approved_or_pre_completed_stages: 2,
      skipped_by_override_stages: 1,
      total_required_stages: 9,
      percent: 22,
    },
    current_stage: stages[0],
    created_at: now,
    updated_at: now,
  };
}

function setOwnerAuth() {
  sectionCapabilities = buildCapabilities();
  mockAuth = {
    access: {
      canAssignTasks: false,
      canApproveCompletedTasks: false,
      canChangeFixtureStage: false,
      canAssignControlDesignProjects: false,
    },
    user: {
      employee_id: "EMP-OWNER",
      department_id: "control",
      role_id: "designer",
      role: { id: "designer", name: "Designer", permissions: {} },
      permissions: [],
    },
  };
}

function setLeaderAuth() {
  sectionCapabilities = buildCapabilities({
    canViewAllProjects: true,
    canAssignProject: true,
    canReassignProject: true,
    canReview: true,
    canApprove: true,
    canRequestChanges: true,
    canRaiseRevision: true,
    canReviewRevision: true,
    canMarkPreCompleted: true,
    canOverrideUnlock: true,
    canSkipStage: true,
    canMarkDispatched: true,
    canViewAudit: true,
    canViewReports: true,
  });
  mockAuth = {
    access: {
      canAssignTasks: true,
      canApproveCompletedTasks: true,
      canChangeFixtureStage: true,
      canAssignControlDesignProjects: true,
    },
    user: {
      employee_id: "EMP-LEAD",
      department_id: "control",
      role_id: "team_leader",
      role: { id: "team_leader", name: "Team Leader", permissions: {} },
      permissions: [],
    },
  };
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ControlWorkflowSection project={project} capabilities={sectionCapabilities} />
    </QueryClientProvider>,
  );
}

describe("ControlWorkflowSection", () => {
  beforeEach(() => {
    setOwnerAuth();
    controlApi.fetchControlSubDepartments.mockResolvedValue([
      { id: "sub-control-design", department_id: "control", subdivision_name: "Control Design", is_active: true },
    ]);
    controlApi.fetchControlWorkflowTemplate.mockResolvedValue({
      id: "template-control-design",
      department_id: "control",
      department_name: "Control",
      sub_department_id: "sub-control-design",
      sub_department_name: "Control Design",
      name: "Control Design",
      template_name: "Control Design",
      is_active: true,
      stages: [],
    });
    controlApi.fetchControlProjectWorkflow.mockResolvedValue(workflow());
    controlApi.fetchControlPendingApprovals.mockResolvedValue([
      {
        id: "submission-queue-1",
        workflow_stage_id: "stage-3",
        workflow_id: "workflow-1",
        submitted_by: "EMP-OWNER",
        submitted_by_name: "Owner User",
        submitted_document_path: "\\\\server\\control\\release.pdf",
        remarks: "Ready",
        status: "pending",
        reviewed_by: null,
        reviewed_by_name: null,
        reviewed_at: null,
        review_remarks: null,
        created_at: now,
        updated_at: now,
        stage_name: "CO Release",
        due_date: "2026-07-10T10:00:00.000Z",
        assigned_user_id: "EMP-OWNER",
        project_no: "PARC-001",
        project_name: "Press Line",
        customer_name: "ACME",
        sub_department_name: "Control Design",
      },
    ]);
    controlApi.fetchControlRevisionQueue.mockResolvedValue([revision({ id: "revision-queue-1" })]);
    controlApi.fetchControlDesignAssignableUsers.mockResolvedValue([
      {
        employee_id: "EMP-OWNER",
        name: "Owner User",
        role_id: "designer",
        department_id: "control",
        is_active: true,
        incomplete_task_count: 0,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the Control Design workflow tree and owner actions without reviewer controls", async () => {
    renderSection();

    expect(await screen.findByRole("heading", { name: "Control Design" })).toBeInTheDocument();
    expect((await screen.findAllByText("CO Creation")).length).toBeGreaterThan(0);
    expect(screen.getByText("Manual Preparation")).toBeInTheDocument();
    expect(screen.getAllByText("Locked until previous stage is approved").length).toBeGreaterThan(0);
    expect(screen.getByText("1 stage skipped by override.")).toBeInTheDocument();
    const submitButtons = screen.getAllByRole("button", { name: /Submit for Approval/i });
    expect(submitButtons.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Update Document Path/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Override Unlock$/i })).not.toBeInTheDocument();

    fireEvent.click(submitButtons[0]);
    expect(screen.getByRole("heading", { name: "Submit for Approval" })).toBeInTheDocument();
    expect(screen.getByLabelText("Submitted document path")).toHaveValue("\\\\server\\control\\co.xlsx");
  }, 15000);

  it("renders reviewer approval, revision, override, and pre-completed controls", async () => {
    setLeaderAuth();
    renderSection();

    expect(await screen.findByRole("heading", { name: "Control Design" })).toBeInTheDocument();
    await waitFor(() => expect(controlApi.fetchControlDesignAssignableUsers).toHaveBeenCalled());

    expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
    expect(screen.getAllByText("Revision Required").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EMP-OWNER - Owner User").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^Approve$/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Raise Revision$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Override Unlock$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Mark Pre-Completed$/i }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^Approve$/i }));
    expect(screen.getByRole("heading", { name: "Approval Review" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revision Required" }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Override Unlock$/i })[0]);
    expect(screen.getByRole("heading", { name: "Override Unlock" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Mark Pre-Completed$/i })[0]);
    expect(screen.getByRole("heading", { name: "Mark Pre-Completed" })).toBeInTheDocument();
  }, 15000);

  it("does not expose reviewer controls from generic fixture permissions alone", async () => {
    setLeaderAuth();
    sectionCapabilities = buildCapabilities({ canViewAllProjects: true });
    renderSection();

    expect(await screen.findByRole("heading", { name: "Control Design" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Raise Revision$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Override Unlock$/i })).not.toBeInTheDocument();
    expect(controlApi.fetchControlPendingApprovals).not.toHaveBeenCalled();
  }, 15000);
});