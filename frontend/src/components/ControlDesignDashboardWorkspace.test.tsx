import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlDesignDashboardWorkspace } from "@/components/ControlDesignDashboardWorkspace";
import type { ControlDesignCapabilities, ControlDesignProject, ControlProjectWorkflow, ControlWorkflowTemplate } from "@/api/controlWorkflowApi";
import type { User } from "@/types";

const controlApi = vi.hoisted(() => ({
  approveControlWorkflowRevision: vi.fn(),
  approveControlWorkflowStage: vi.fn(),
  assignControlDesignProjectOwner: vi.fn(),
  createControlDesignProject: vi.fn(),
  fetchControlDesignAssignableUsers: vi.fn(),
  fetchControlDesignCapabilities: vi.fn(),
  fetchControlDesignProjects: vi.fn(),
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
  raiseControlWorkflowRevision: vi.fn(),
  reassignControlProjectWorkflowOwner: vi.fn(),
  skipControlWorkflowStageByOverride: vi.fn(),
  startControlWorkflowRevision: vi.fn(),
  startControlWorkflowStage: vi.fn(),
  submitControlWorkflowRevision: vi.fn(),
  submitControlWorkflowStage: vi.fn(),
  updateControlWorkflowDocumentPath: vi.fn(),
}));

let mockAuth: {
  user: Partial<User>;
  access: Record<string, boolean>;
};
let mockCapabilities: ControlDesignCapabilities;

vi.mock("@/api/controlWorkflowApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/controlWorkflowApi")>();
  return {
    ...actual,
    approveControlWorkflowRevision: (...args: unknown[]) => controlApi.approveControlWorkflowRevision(...args),
    approveControlWorkflowStage: (...args: unknown[]) => controlApi.approveControlWorkflowStage(...args),
    assignControlDesignProjectOwner: (...args: unknown[]) => controlApi.assignControlDesignProjectOwner(...args),
    createControlDesignProject: (...args: unknown[]) => controlApi.createControlDesignProject(...args),
    fetchControlDesignAssignableUsers: (...args: unknown[]) => controlApi.fetchControlDesignAssignableUsers(...args),
    fetchControlDesignCapabilities: (...args: unknown[]) => controlApi.fetchControlDesignCapabilities(...args),
    fetchControlDesignProjects: (...args: unknown[]) => controlApi.fetchControlDesignProjects(...args),
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
    raiseControlWorkflowRevision: (...args: unknown[]) => controlApi.raiseControlWorkflowRevision(...args),
    reassignControlProjectWorkflowOwner: (...args: unknown[]) => controlApi.reassignControlProjectWorkflowOwner(...args),
    skipControlWorkflowStageByOverride: (...args: unknown[]) => controlApi.skipControlWorkflowStageByOverride(...args),
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

const stageNames = [
  "CO Creation",
  "ERP Budget Approval",
  "CO Release",
  "WBS Addition",
  "I/O List Preparation",
  "E-Plan Drawing Release",
  "Panel Material Issue",
  "Field Material Preparation",
  "Manual Preparation",
];

function buildProject(overrides: Partial<ControlDesignProject> = {}): ControlDesignProject {
  return {
    project_id: "project-1",
    project_no: "PARC104",
    project_name: "Press Line",
    customer_name: "ABC Automation",
    department_id: "control",
    department_name: "Control",
    project_status: "active",
    completion_percent: null,
    total_fixtures: 0,
    total_tasks: 0,
    pending_tasks: 0,
    active_tasks: 0,
    completed_tasks: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    control_record: {
      id: "co-1",
      project_id: "project-1",
      sub_department_id: "sub-control-design",
      budget_amount: 250000,
      budget_currency: "INR",
      status: "active",
      lifecycle_status: "assigned",
      created_by: "EMP-MGR",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    lifecycle_summary: {
      total_stage_count: 9,
      approved_stage_count: 0,
      pending_approval_count: 0,
      updates_required_count: 0,
      lifecycle_started: true,
      completed: false,
    },
    workflow: {
      id: "workflow-1",
      project_id: "project-1",
      sub_department_id: "sub-control-design",
      assigned_user_id: "EMP-CD-1",
      assigned_user_name: "Control Designer",
      assigned_by: "EMP-MGR",
      assigned_by_name: "Control Manager",
      current_stage_id: "stage-1",
      status: "active",
      template_id: "template-1",
      template_name: "Control Design",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

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

const project = buildProject();
const newProject = buildProject({
  project_id: "project-2",
  project_no: "PARC2600M029",
  project_name: "New Press",
  customer_name: "Tata Motors",
  control_record: {
    id: "co-2",
    project_id: "project-2",
    sub_department_id: "sub-control-design",
    budget_amount: 1250000,
    budget_currency: "INR",
    status: "active",
    lifecycle_status: "assigned",
    created_by: "EMP-MGR",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  },
  workflow: {
    id: "workflow-2",
    project_id: "project-2",
    sub_department_id: "sub-control-design",
    assigned_user_id: "EMP-CD-1",
    assigned_user_name: "Control Designer",
    assigned_by: "EMP-MGR",
    assigned_by_name: "Control Manager",
    current_stage_id: "stage-2-1",
    status: "active",
    template_id: "template-1",
    template_name: "Control Design",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  },
});

const template: ControlWorkflowTemplate = {
  id: "template-1",
  department_id: "control",
  department_name: "Control",
  sub_department_id: "sub-control-design",
  sub_department_name: "Control Design",
  name: "Control Design",
  template_name: "Control Design",
  is_active: true,
  stages: stageNames.map((stageName, index) => ({
    id: `template-stage-${index + 1}`,
    template_id: "template-1",
    stage_name: stageName,
    sequence_order: index + 1,
    is_required: true,
  })),
};

function buildWorkflow(projectId = "project-1", workflowId = "workflow-1"): ControlProjectWorkflow {
  return {
    id: workflowId,
    project_id: projectId,
    project_no: projectId === "project-2" ? "PARC2600M029" : "PARC104",
    project_name: projectId === "project-2" ? "New Press" : "Press Line",
    customer_name: projectId === "project-2" ? "Tata Motors" : "ABC Automation",
    project_status: "active",
    dispatch_status: null,
    department_id: "control",
    department_name: "Control",
    sub_department_id: "sub-control-design",
    sub_department_name: "Control Design",
    template_id: "template-1",
    template_name: "Control Design",
    assigned_user_id: "EMP-CD-1",
    assigned_user_name: "Control Designer",
    assigned_by: "EMP-MGR",
    assigned_by_name: "Control Manager",
    current_stage_id: projectId === "project-2" ? "stage-2-1" : "stage-1",
    status: "active",
    stages: stageNames.map((stageName, index) => ({
      id: projectId === "project-2" ? `stage-2-${index + 1}` : `stage-${index + 1}`,
      workflow_id: workflowId,
      template_stage_id: `template-stage-${index + 1}`,
      stage_name: stageName,
      sequence_order: index + 1,
      is_required: true,
      status: index === 0 ? "not_started" : "locked",
      revision_count: 0,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      submissions: [],
      revisions: [],
      document_history: [],
      override_history: [],
      events: [],
    })),
    progress: {
      approved_or_pre_completed_stages: 0,
      skipped_by_override_stages: 0,
      total_required_stages: 9,
      percent: 0,
    },
    current_stage: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

function setAuth(canCreate: boolean, canAssign = canCreate) {
  mockCapabilities = buildCapabilities({
    canViewAllProjects: canCreate || canAssign,
    canCreateProject: canCreate,
    canAssignProject: canAssign,
    canReassignProject: canAssign,
    canReview: canCreate || canAssign,
    canApprove: canCreate || canAssign,
    canRequestChanges: canCreate || canAssign,
    canRaiseRevision: canCreate || canAssign,
    canReviewRevision: canCreate || canAssign,
    canMarkPreCompleted: canCreate || canAssign,
    canOverrideUnlock: canCreate || canAssign,
    canSkipStage: canCreate || canAssign,
    canMarkDispatched: canCreate || canAssign,
    canViewAudit: canCreate || canAssign,
    canViewReports: canCreate || canAssign,
  });
  mockAuth = {
    user: {
      employee_id: canCreate || canAssign ? "EMP-MGR" : "EMP-CD-1",
      name: canCreate || canAssign ? "Control Manager" : "Control Designer",
      department_id: "control",
      department: { id: "control", name: "Control" },
      subdivision_id: "sub-control-design",
      subdivision: {
        id: "sub-control-design",
        department_id: "control",
        subdivision_name: "Control Design",
        is_active: true,
      },
      role_id: canCreate || canAssign ? "r3" : "r6",
      permissions: [
        "control_design.workspace.view",
        ...(canCreate ? ["control_design.projects.create"] : []),
        ...(canAssign ? ["control_design.projects.assign", "control_design.projects.reassign"] : []),
      ],
      is_active: true,
      created_at: "2026-07-01T00:00:00.000Z",
    },
    access: {
      canAssignTasks: false,
      canCreateControlDesignProjects: canCreate,
      canAssignControlDesignProjects: canAssign,
      canReassignControlDesignProjects: canAssign,
      canViewAllControlDesignProjects: canCreate || canAssign,
    },
  };
}

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ControlDesignDashboardWorkspace />
    </QueryClientProvider>,
  );
}

describe("ControlDesignDashboardWorkspace", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    controlApi.fetchControlDesignCapabilities.mockImplementation(() => Promise.resolve(mockCapabilities));
    controlApi.fetchControlDesignProjects.mockResolvedValue([project]);
    controlApi.fetchControlSubDepartments.mockResolvedValue([
      { id: "sub-control-design", department_id: "control", subdivision_name: "Control Design", is_active: true },
    ]);
    controlApi.fetchControlWorkflowTemplate.mockResolvedValue(template);
    controlApi.fetchControlPendingApprovals.mockResolvedValue([]);
    controlApi.fetchControlRevisionQueue.mockResolvedValue([]);
    controlApi.fetchControlProjectWorkflow.mockImplementation((projectId: string) => (
      Promise.resolve(projectId === "project-2" ? buildWorkflow("project-2", "workflow-2") : buildWorkflow())
    ));
    controlApi.fetchControlDesignAssignableUsers.mockResolvedValue([
      { employee_id: "EMP-CD-1", name: "Control Designer", department_id: "control", is_active: true, created_at: "2026-07-01T00:00:00.000Z" },
    ]);
    controlApi.createControlDesignProject.mockResolvedValue(newProject);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the scoped summary, project selector, and lifecycle for authorized Control Design users", async () => {
    setAuth(true);
    renderWorkspace();

    expect((await screen.findAllByText("Press Line"))[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Project/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Total Projects/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /Active Projects/ })).toHaveTextContent("1");
    expect(screen.getByRole("heading", { name: "Control Design Projects" })).toBeInTheDocument();
    expect(screen.getAllByText("CO Creation").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Manual Preparation").length).toBeGreaterThan(0);
    expect(screen.queryByText(/fixture/i)).not.toBeInTheDocument();
  }, 15000);

  it("filters and resets the scoped project list from lifecycle summary cards", async () => {
    setAuth(true);
    const completedProject = buildProject({
      project_id: "project-complete",
      project_no: "PARC-COMPLETE",
      project_name: "Completed Line",
      project_status: "completed",
      lifecycle_summary: {
        total_stage_count: 9,
        approved_stage_count: 9,
        pending_approval_count: 0,
        updates_required_count: 0,
        lifecycle_started: true,
        completed: true,
      },
      workflow: {
        ...project.workflow!,
        id: "workflow-complete",
        project_id: "project-complete",
        status: "completed",
      },
    });
    controlApi.fetchControlDesignProjects.mockResolvedValue([project, completedProject]);
    renderWorkspace();

    expect(await screen.findByRole("button", { name: /Total Projects 2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Active Projects 1/ })).toBeInTheDocument();
    const completedFilter = screen.getByRole("button", { name: /Completed Projects 1/ });
    fireEvent.click(completedFilter);

    expect(completedFilter).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Select a Control Design project to view its lifecycle.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "Project" }));
    expect(await screen.findByRole("option", { name: /PARC-COMPLETE.*Completed Line/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /PARC104.*Press Line/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /PARC-COMPLETE.*Completed Line/ }));

    fireEvent.click(screen.getByRole("button", { name: "Clear lifecycle filter" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Project" }));
    expect(await screen.findByRole("option", { name: /PARC104.*Press Line/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /PARC-COMPLETE.*Completed Line/ })).toBeInTheDocument();
  });


  it("creates a project with a required assigned member and selects it", async () => {
    setAuth(true);
    controlApi.fetchControlDesignProjects.mockResolvedValueOnce([project]).mockResolvedValue([newProject, project]);
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /New Project/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "New Control Design Project" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(4);
    expect(within(dialog).getByLabelText("Project ID")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Project Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Customer")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Budget (INR)")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Assigned Control Design member" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Budget Currency/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Sub-department/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/fixture/i)).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Project ID"), { target: { value: " PARC2600M029 " } });
    fireEvent.change(within(dialog).getByLabelText("Project Name"), { target: { value: " New Press " } });
    fireEvent.change(within(dialog).getByLabelText("Customer"), { target: { value: " Tata Motors " } });
    fireEvent.change(within(dialog).getByLabelText("Budget (INR)"), { target: { value: "1250000.00" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Assigned Control Design member" }));
    const assigneeOption = await screen.findByRole("option", { name: /EMP-CD-1 - Control Designer/ });
    fireEvent.click(assigneeOption);
    fireEvent.click(within(dialog).getByRole("button", { name: /Create Project/ }));

    await waitFor(() => expect(controlApi.createControlDesignProject).toHaveBeenCalledWith({
      projectId: "PARC2600M029",
      projectName: "New Press",
      customer: "Tata Motors",
      budget: "1250000.00",
      assignedUserId: "EMP-CD-1",
    }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "New Control Design Project" })).not.toBeInTheDocument());
    await waitFor(() => expect(controlApi.fetchControlDesignProjects).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("PARC2600M029 \u2014 New Press");
    expect((await screen.findAllByText("New Press"))[0]).toBeInTheDocument();
    expect(screen.getAllByText(/EMP-CD-1 - Control Designer/).length).toBeGreaterThan(0);
    expect(screen.getByText("Project Lifecycle")).toBeInTheDocument();
    expect(screen.getAllByText("CO Creation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not Started").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Locked").length).toBeGreaterThanOrEqual(8);
  });

  it("blocks empty required fields and invalid budget before submitting", async () => {
    setAuth(true);
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /New Project/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Create Project/ }));

    expect(await within(dialog).findByText("Project ID is required.")).toBeInTheDocument();
    expect(within(dialog).getByText("Project Name is required.")).toBeInTheDocument();
    expect(within(dialog).getByText("Customer is required.")).toBeInTheDocument();
    expect(within(dialog).getByText("Budget is required.")).toBeInTheDocument();
    expect(within(dialog).getByText("Assigned Control Design member is required.")).toBeInTheDocument();
    expect(controlApi.createControlDesignProject).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Project ID"), { target: { value: "TEST-CD-001" } });
    fireEvent.change(within(dialog).getByLabelText("Project Name"), { target: { value: "Control Design Test" } });
    fireEvent.change(within(dialog).getByLabelText("Customer"), { target: { value: "Internal Test" } });
    fireEvent.change(within(dialog).getByLabelText("Budget (INR)"), { target: { value: "-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create Project/ }));

    expect(await within(dialog).findByText("Budget must be a non-negative decimal amount.")).toBeInTheDocument();
    expect(controlApi.createControlDesignProject).not.toHaveBeenCalled();
  });

  it("shows backend creation errors without clearing entered values", async () => {
    setAuth(true);
    controlApi.createControlDesignProject.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { status: 409 }));
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /New Project/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Project ID"), { target: { value: "TEST-CD-001" } });
    fireEvent.change(within(dialog).getByLabelText("Project Name"), { target: { value: "Control Design Test" } });
    fireEvent.change(within(dialog).getByLabelText("Customer"), { target: { value: "Internal Test" } });
    fireEvent.change(within(dialog).getByLabelText("Budget (INR)"), { target: { value: "1000" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Assigned Control Design member" }));
    const assigneeOption = await screen.findByRole("option", { name: /EMP-CD-1 - Control Designer/ });
    fireEvent.click(assigneeOption);
    fireEvent.click(within(dialog).getByRole("button", { name: /Create Project/ }));

    expect(await within(dialog).findByText("Duplicate Project ID")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Project ID")).toHaveValue("TEST-CD-001");
    expect(within(dialog).getByLabelText("Budget (INR)")).toHaveValue("1000");
  });

  it("hides creation and reassignment controls for regular Control Design users", async () => {
    setAuth(false);
    renderWorkspace();

    expect((await screen.findAllByText("Press Line"))[0]).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Project/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reassign$/ })).not.toBeInTheDocument();
    expect(controlApi.fetchControlDesignAssignableUsers).not.toHaveBeenCalled();
  });

  it("keeps project creation separate from assignment permission", async () => {
    setAuth(false, true);
    renderWorkspace();

    expect((await screen.findAllByText("Press Line"))[0]).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Project/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Reassign$/ })).toBeInTheDocument();
  });

  it("requires backend Control Design workspace capability before loading data", async () => {
    setAuth(true);
    mockCapabilities = buildCapabilities({ canViewWorkspace: false });
    mockAuth.user = {
      ...mockAuth.user,
      department_id: "design",
      department: { id: "design", name: "Design" },
    };
    renderWorkspace();

    expect(await screen.findByText("You do not have Control Design workspace access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Project/ })).not.toBeInTheDocument();
    expect(controlApi.fetchControlDesignProjects).not.toHaveBeenCalled();
  });

  it("loads assignable members when creation is allowed without reassignment", async () => {
    setAuth(true, false);
    renderWorkspace();

    expect((await screen.findAllByText("Press Line"))[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Project/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reassign$/ })).not.toBeInTheDocument();
    await waitFor(() => expect(controlApi.fetchControlDesignAssignableUsers).toHaveBeenCalled());
  });

  it("shows the authorized empty state with project creation", async () => {
    setAuth(true);
    controlApi.fetchControlDesignProjects.mockResolvedValue([]);
    renderWorkspace();

    expect(await screen.findByText("No Control Design projects are available in your current scope.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /New Project/ }).length).toBeGreaterThan(0);
  });

  it("shows the regular-user empty state without creation controls", async () => {
    setAuth(false);
    controlApi.fetchControlDesignProjects.mockResolvedValue([]);
    renderWorkspace();

    expect(await screen.findByText("No Control Design projects are available in your current scope.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Project/ })).not.toBeInTheDocument();
  });
});