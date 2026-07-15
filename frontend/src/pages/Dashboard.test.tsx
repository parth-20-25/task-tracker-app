import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/pages/Dashboard";
import type { ProjectDashboardSummary, Task, User } from "@/types";

const designApi = vi.hoisted(() => ({
  fetchProjectDashboardSummary: vi.fn(),
  fetchDesignFixtures: vi.fn(),
  reactivateProject: vi.fn(),
  updateProjectModification: vi.fn(),
}));

const executiveDashboard = vi.hoisted(() => ({
  render: vi.fn(),
}));

const taskState = vi.hoisted(() => ({
  tasks: [] as Task[],
}));

let mockAuth: {
  user: Partial<User> | null;
  role: { id: string; name: string } | null;
  access: Record<string, boolean>;
  isAuthenticated: boolean;
  isReady: boolean;
};

vi.mock("@/api/designApi", () => ({
  fetchProjectDashboardSummary: (...args: unknown[]) => designApi.fetchProjectDashboardSummary(...args),
  fetchDesignFixtures: (...args: unknown[]) => designApi.fetchDesignFixtures(...args),
  reactivateProject: (...args: unknown[]) => designApi.reactivateProject(...args),
  updateProjectModification: (...args: unknown[]) => designApi.updateProjectModification(...args),
}));

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/contexts/useTasks", () => ({
  useTasks: () => ({ tasks: taskState.tasks, isLoading: false }),
}));

vi.mock("@/hooks/queries/useOverdueNotificationsQuery", () => ({
  useMyOverdueAlertsQuery: () => ({ data: [] }),
  useTeamOverdueAlertsQuery: () => ({ data: [] }),
}));

vi.mock("@/components/native-ingestion/NativeIngestionWorkspace", () => ({
  NativeFixtureIngestionLauncher: () => <div>Native Fixture Upload</div>,
  NativeProjectEditWorkspace: () => null,
}));

vi.mock("@/components/ExecutiveDashboard", () => ({
  ExecutiveDashboard: () => {
    executiveDashboard.render();
    return <div>Executive Dashboard Surface</div>;
  },
}));

vi.mock("@/components/ControlDesignDashboardWorkspace", () => ({
  ControlDesignDashboardWorkspace: () => <div>Control Design Dedicated Workspace</div>,
}));

vi.mock("@/components/ProjectFixtureOperations", () => ({
  ProjectFixtureOperationsGrid: () => <div>Fixture Operations Grid</div>,
}));

vi.mock("@/components/Design2DCompletionTasks", () => ({
  Design2DCompletionTasks: () => <h2>2D Completion Tasks</h2>,
}));

vi.mock("@/components/OverdueAlertModal", () => ({
  OverdueAlertModal: () => null,
}));

vi.mock("@/components/ProjectReactivationDialog", () => ({
  ProjectReactivationDialog: () => null,
}));


vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const project = {
  project_id: "project-1",
  project_no: "PARC-104",
  project_name: "Press Line",
  customer_name: "ABC Automation",
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

const baseAccess = {
  canAccessProjectFixtures: true,
  canUploadNativeDesignData: true,
  canViewTeamTasks: false,
  canApproveCompletedTasks: false,
  canApproveQuality: false,
  canViewSelfTasks: true,
  canViewAllTasks: false,
  canAssignTasks: false,
  canChangeFixtureStage: false,
  canCreateControlDesignProjects: false,
  canAssignControlDesignProjects: false,
  canReassignControlDesignProjects: false,
  canViewAllControlDesignProjects: false,
};

function buildControlUser(overrides: Partial<User> = {}) {
  return {
    employee_id: "EMP-CONTROL",
    name: "Control User",
    department_id: "control",
    department: { id: "control", name: "Control" },
    role_id: "team_leader",
    role: { id: "team_leader", name: "Team Leader", hierarchy_level: 2, permissions: {}, scope: "department" },
    permissions: [],
    is_active: true,
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } satisfies Partial<User>;
}

function setMockAuth({
  user,
  role,
  access,
  isReady = true,
}: {
  user: Partial<User> | null;
  role: { id: string; name: string } | null;
  access: Record<string, boolean>;
  isReady?: boolean;
}) {
  mockAuth = {
    user,
    role,
    access,
    isReady,
    isAuthenticated: isReady && Boolean(user),
  };
}

function setControlDesignAuth() {
  const user = buildControlUser({
    permissions: ["control_design.workspace.view"],
    subdivision_id: "sub-control-design",
    subdivision: {
      id: "sub-control-design",
      department_id: "control",
      subdivision_name: "Control Design",
      is_active: true,
    },
  });
  setMockAuth({
    user,
    role: { id: "team_leader", name: "Team Leader" },
    access: { ...baseAccess, canViewControlDesignWorkspace: true, canAssignTasks: true, canCreateControlDesignProjects: true, canAssignControlDesignProjects: true },
  });
}

function setControlWithoutDesignSubdivisionAuth(accessOverrides: Record<string, boolean> = {}) {
  setMockAuth({
    user: buildControlUser(),
    role: { id: "team_leader", name: "Team Leader" },
    access: { ...baseAccess, canAssignTasks: true, canApproveCompletedTasks: true, canChangeFixtureStage: true, ...accessOverrides },
  });
}

function setControlOtherSubdivisionAuth() {
  const user = buildControlUser({
    subdivision_id: "sub-plc",
    subdivision: {
      id: "sub-plc",
      department_id: "control",
      subdivision_name: "PLC Programming",
      is_active: true,
    },
  });
  setMockAuth({
    user,
    role: { id: "team_leader", name: "Team Leader" },
    access: { ...baseAccess, canAssignTasks: true },
  });
}

function setDesignAuth(accessOverrides: Record<string, boolean> = {}) {
  setMockAuth({
    user: {
      employee_id: "EMP-DESIGN",
      name: "Design User",
      department_id: "design",
      department: { id: "design", name: "Design" },
      role_id: "team_leader",
      role: { id: "team_leader", name: "Team Leader", hierarchy_level: 2, permissions: {}, scope: "department" },
      permissions: [],
      is_active: true,
      created_at: "2026-07-01T00:00:00.000Z",
    },
    role: { id: "team_leader", name: "Team Leader" },
    access: { ...baseAccess, ...accessOverrides },
  });
}

function setDesignEmployeeAuth() {
  setMockAuth({
    user: {
      employee_id: "EMP-DESIGN-1",
      name: "Design Employee",
      department_id: "design",
      department: { id: "design", name: "Design" },
      role_id: "employee",
      role: { id: "employee", name: "Employee", hierarchy_level: 6, permissions: {}, scope: "self" },
      permissions: [],
      is_active: true,
      created_at: "2026-07-01T00:00:00.000Z",
    },
    role: { id: "employee", name: "Employee" },
    access: {
      ...baseAccess,
      canAccessProjectFixtures: false,
      canUploadNativeDesignData: false,
      canViewSelfTasks: true,
    },
  });
}

function setExecutiveAuth(roleOverride: { id: string; name: string; hierarchy_level?: number } = { id: "r1", name: "Admin", hierarchy_level: 1 }) {
  const role = {
    id: roleOverride.id,
    name: roleOverride.name,
    hierarchy_level: roleOverride.hierarchy_level ?? 1,
    permissions: roleOverride.id === "r1" ? { all: true } : {},
    scope: "global" as const,
  };
  setMockAuth({
    user: {
      employee_id: `EMP-${roleOverride.id.toUpperCase()}`,
      name: `${roleOverride.name} User`,
      department_id: "design",
      department: { id: "design", name: "Design" },
      role_id: roleOverride.id,
      role,
      permissions: [],
      is_active: true,
      created_at: "2026-07-01T00:00:00.000Z",
    },
    role: { id: roleOverride.id, name: roleOverride.name },
    access: { ...baseAccess, canViewAllDepartmentsAnalytics: true },
  });
}

function setLoadingAuth() {
  setMockAuth({
    user: null,
    role: null,
    access: { ...baseAccess },
    isReady: false,
  });
}
function renderDashboard(route = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Dashboard workspace routing", () => {
  beforeEach(() => {
    designApi.fetchProjectDashboardSummary.mockResolvedValue([project]);
    designApi.fetchDesignFixtures.mockResolvedValue([]);
    designApi.reactivateProject.mockResolvedValue({ message: "reactivated" });
    designApi.updateProjectModification.mockResolvedValue(project);
    taskState.tasks = [];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    executiveDashboard.render.mockClear();
  });

  it("renders the executive dashboard for Admin users", async () => {
    setExecutiveAuth();
    renderDashboard();

    expect(await screen.findByText("Executive Dashboard Surface")).toBeInTheDocument();
    expect(executiveDashboard.render).toHaveBeenCalledTimes(1);
    expect(designApi.fetchProjectDashboardSummary).not.toHaveBeenCalled();
  });

  it("renders the executive dashboard for CEO and Director users", async () => {
    setExecutiveAuth({ id: "ceo", name: "CEO" });
    const { unmount } = renderDashboard();

    expect(await screen.findByText("Executive Dashboard Surface")).toBeInTheDocument();
    expect(executiveDashboard.render).toHaveBeenCalledTimes(1);
    unmount();
    cleanup();
    vi.clearAllMocks();
    executiveDashboard.render.mockClear();

    setExecutiveAuth({ id: "director", name: "Director" });
    renderDashboard();

    expect(await screen.findByText("Executive Dashboard Surface")).toBeInTheDocument();
    expect(executiveDashboard.render).toHaveBeenCalledTimes(1);
    expect(designApi.fetchProjectDashboardSummary).not.toHaveBeenCalled();
  });

  it("routes actual Control Design subdivision users to the dedicated workspace", async () => {
    setControlDesignAuth();
    renderDashboard();

    expect(await screen.findByText("Control Design Dedicated Workspace")).toBeInTheDocument();
    expect(screen.queryByText("Native Fixture Upload")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Project Fixtures" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "2D Completion Tasks" })).not.toBeInTheDocument();
    expect(designApi.fetchProjectDashboardSummary).not.toHaveBeenCalled();
    expect(designApi.fetchDesignFixtures).not.toHaveBeenCalled();
  });

  it("does not infer Control Design workspace access from role or fixture permissions", async () => {
    setControlWithoutDesignSubdivisionAuth();
    renderDashboard();

    expect(await screen.findByText("Native Fixture Upload")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Fixtures" })).toBeInTheDocument();
    expect(screen.queryByText("Control Design Dedicated Workspace")).not.toBeInTheDocument();
  });

  it("keeps Control users outside Control Design on the operational workspace", async () => {
    setControlOtherSubdivisionAuth();
    renderDashboard();

    expect(await screen.findByText("Native Fixture Upload")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Fixtures" })).toBeInTheDocument();
    expect(screen.queryByText("Control Design Dedicated Workspace")).not.toBeInTheDocument();
  });

  it("shows the 2D completion board beside Project Fixtures for Design assignment leaders", async () => {
    setDesignAuth({ canAssignTasks: true });
    renderDashboard();

    expect(await screen.findByText("Native Fixture Upload")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Fixtures" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2D Completion Tasks" })).toBeInTheDocument();
    expect(screen.getByText("Select a project above to view fixture-level operational status.")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings.indexOf("2D Completion Tasks")).toBe(headings.indexOf("Project Fixtures") + 1);
    expect(executiveDashboard.render).not.toHaveBeenCalled();
    await waitFor(() => expect(designApi.fetchProjectDashboardSummary).toHaveBeenCalledTimes(1));
  });

  it("hides the 2D completion board without 2D subdivision visibility or assignment authority", async () => {
    setDesignAuth();
    renderDashboard();

    expect(await screen.findByText("Native Fixture Upload")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Fixtures" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "2D Completion Tasks" })).not.toBeInTheDocument();
  });

  it("keeps Team Leaders with analytics permissions on the operational dashboard", async () => {
    setDesignAuth({ canViewDepartmentAnalytics: true, canViewAllDepartmentsAnalytics: true });
    renderDashboard();

    expect(await screen.findByText("Native Fixture Upload")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Fixtures" })).toBeInTheDocument();
    expect(screen.queryByText("Executive Dashboard Surface")).not.toBeInTheDocument();
    expect(executiveDashboard.render).not.toHaveBeenCalled();
    await waitFor(() => expect(designApi.fetchProjectDashboardSummary).toHaveBeenCalledTimes(1));
  });

  it("keeps Design employees on the original self-service dashboard", async () => {
    setDesignEmployeeAuth();
    renderDashboard();

    expect(await screen.findByRole("heading", { name: "Welcome, Design" })).toBeInTheDocument();
    expect(screen.queryByText("Executive Dashboard Surface")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Project Fixtures" })).not.toBeInTheDocument();
    expect(executiveDashboard.render).not.toHaveBeenCalled();
    expect(designApi.fetchProjectDashboardSummary).not.toHaveBeenCalled();
  });

  it("does not render additional design tasks on the dashboard", async () => {
    setDesignEmployeeAuth();
    taskState.tasks = [{
      id: 101,
      title: "PPT",
      task_type: "additional_design",
      additional_task_kind: "PPT",
      design_team: "3D",
      description: "Prepare slides",
      assigned_to: "EMP-DESIGN-1",
      assignee_ids: ["EMP-DESIGN-1"],
      assigned_by: "LEAD-3D",
      department_id: "design",
      status: "assigned",
      completion_percent: 0,
      verification_status: "pending",
      priority: "medium",
      deadline: "2026-07-16T04:30:00.000Z",
      created_at: "2026-07-15T00:00:00.000Z",
      planned_minutes: 0,
      actual_minutes: 0,
      dependency_ids: [],
      escalation_level: 0,
      requires_quality_approval: false,
      approval_required: true,
      proof_required: true,
    } as Task];

    renderDashboard();

    expect(await screen.findByRole("heading", { name: "Welcome, Design" })).toBeInTheDocument();
    expect(screen.queryByText("My Additional Design Tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("PPT")).not.toBeInTheDocument();
  });

  it("keeps Control users with analytics permissions off the executive dashboard", async () => {
    setControlWithoutDesignSubdivisionAuth({ canViewDepartmentAnalytics: true, canViewAllDepartmentsAnalytics: true });
    renderDashboard();

    expect(await screen.findByText("Native Fixture Upload")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Fixtures" })).toBeInTheDocument();
    expect(screen.queryByText("Executive Dashboard Surface")).not.toBeInTheDocument();
    expect(executiveDashboard.render).not.toHaveBeenCalled();
  });

  it("does not flash either dashboard while authentication is loading", () => {
    setLoadingAuth();
    renderDashboard();

    expect(screen.queryByText("Executive Dashboard Surface")).not.toBeInTheDocument();
    expect(screen.queryByText("Native Fixture Upload")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Project Fixtures" })).not.toBeInTheDocument();
    expect(executiveDashboard.render).not.toHaveBeenCalled();
    expect(designApi.fetchProjectDashboardSummary).not.toHaveBeenCalled();
  });
});
