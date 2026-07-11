import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlDesignDashboardWorkspace } from "@/components/ControlDesignDashboardWorkspace";
import type { ControlDesignProject, ControlProjectWorkflow, ControlWorkflowTemplate } from "@/api/controlWorkflowApi";
import type { User } from "@/types";

const controlApi = vi.hoisted(() => ({
  assignControlDesignProjectOwner: vi.fn(),
  createControlDesignProject: vi.fn(),
  fetchControlDesignAssignableUsers: vi.fn(),
  fetchControlDesignProjects: vi.fn(),
  fetchControlProjectWorkflow: vi.fn(),
  fetchControlSubDepartments: vi.fn(),
  fetchControlWorkflowTemplate: vi.fn(),
}));

let mockAuth: {
  user: Partial<User>;
  access: Record<string, boolean>;
};

vi.mock("@/api/controlWorkflowApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/controlWorkflowApi")>();
  return {
    ...actual,
    assignControlDesignProjectOwner: (...args: unknown[]) => controlApi.assignControlDesignProjectOwner(...args),
    createControlDesignProject: (...args: unknown[]) => controlApi.createControlDesignProject(...args),
    fetchControlDesignAssignableUsers: (...args: unknown[]) => controlApi.fetchControlDesignAssignableUsers(...args),
    fetchControlDesignProjects: (...args: unknown[]) => controlApi.fetchControlDesignProjects(...args),
    fetchControlProjectWorkflow: (...args: unknown[]) => controlApi.fetchControlProjectWorkflow(...args),
    fetchControlSubDepartments: (...args: unknown[]) => controlApi.fetchControlSubDepartments(...args),
    fetchControlWorkflowTemplate: (...args: unknown[]) => controlApi.fetchControlWorkflowTemplate(...args),
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
      created_by: "EMP-MGR",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
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
    created_by: "EMP-MGR",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  },
  workflow: {
    id: "workflow-2",
    project_id: "project-2",
    sub_department_id: "sub-control-design",
    assigned_user_id: null,
    assigned_user_name: null,
    assigned_by: null,
    assigned_by_name: null,
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
    assigned_user_id: projectId === "project-2" ? null : "EMP-CD-1",
    assigned_user_name: projectId === "project-2" ? null : "Control Designer",
    assigned_by: projectId === "project-2" ? null : "EMP-MGR",
    assigned_by_name: projectId === "project-2" ? null : "Control Manager",
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
        ...(canCreate ? ["control_design.create_projects"] : []),
        ...(canAssign ? ["control_design.assign_projects"] : []),
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
    controlApi.fetchControlDesignProjects.mockResolvedValue([project]);
    controlApi.fetchControlSubDepartments.mockResolvedValue([
      { id: "sub-control-design", department_id: "control", subdivision_name: "Control Design", is_active: true },
    ]);
    controlApi.fetchControlWorkflowTemplate.mockResolvedValue(template);
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

  it("renders creation, assignment, summary, and lifecycle for authorized Control Design users", async () => {
    setAuth(true);
    renderWorkspace();

    expect(await screen.findByText("Press Line")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Project/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Assign Control Design Project/ })).toBeInTheDocument();
    expect(screen.getAllByText("CO Creation").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Manual Preparation")).toBeInTheDocument();
    expect(screen.queryByText(/fixture/i)).not.toBeInTheDocument();
  });

  it("creates a project from the four-field modal and selects it", async () => {
    setAuth(true);
    controlApi.fetchControlDesignProjects.mockResolvedValueOnce([project]).mockResolvedValue([newProject, project]);
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: /New Project/ }));

    expect(screen.getByRole("heading", { name: "New Control Design Project" })).toBeInTheDocument();
    expect(screen.getByLabelText("Project ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Project Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Customer")).toBeInTheDocument();
    expect(screen.getByLabelText("Budget (INR)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Budget Currency/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Sub-department/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Project ID"), { target: { value: " PARC2600M029 " } });
    fireEvent.change(screen.getByLabelText("Project Name"), { target: { value: " New Press " } });
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: " Tata Motors " } });
    fireEvent.change(screen.getByLabelText("Budget (INR)"), { target: { value: "1250000.00" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Project/ }));

    await waitFor(() => expect(controlApi.createControlDesignProject).toHaveBeenCalledWith({
      project_id: "PARC2600M029",
      project_name: "New Press",
      customer: "Tata Motors",
      budget: "1250000.00",
    }));
    expect(await screen.findByText("New Press")).toBeInTheDocument();
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
  });

  it("hides creation and assignment controls for regular Control Design users", async () => {
    setAuth(false);
    renderWorkspace();

    expect(await screen.findByText("Press Line")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Project/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Assign Control Design Project/ })).not.toBeInTheDocument();
    expect(controlApi.fetchControlDesignAssignableUsers).not.toHaveBeenCalled();
  });

  it("keeps project creation separate from assignment permission", async () => {
    setAuth(false, true);
    renderWorkspace();

    expect(await screen.findByText("Press Line")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Project/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Assign Control Design Project/ })).toBeInTheDocument();
  });

  it("keeps assignment separate from project creation permission", async () => {
    setAuth(true, false);
    renderWorkspace();

    expect(await screen.findByText("Press Line")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Project/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Assign Control Design Project/ })).not.toBeInTheDocument();
    expect(controlApi.fetchControlDesignAssignableUsers).not.toHaveBeenCalled();
  });

  it("shows the authorized empty state with project creation", async () => {
    setAuth(true);
    controlApi.fetchControlDesignProjects.mockResolvedValue([]);
    renderWorkspace();

    expect(await screen.findByText("No Control Design projects have been created yet.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /New Project/ }).length).toBeGreaterThan(0);
  });

  it("shows the regular-user empty state without creation controls", async () => {
    setAuth(false);
    controlApi.fetchControlDesignProjects.mockResolvedValue([]);
    renderWorkspace();

    expect(await screen.findByText("No Control Design projects are currently assigned to you.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Project/ })).not.toBeInTheDocument();
  });
});