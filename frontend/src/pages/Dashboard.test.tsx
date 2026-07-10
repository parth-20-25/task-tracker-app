import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/pages/Dashboard";
import type { ProjectDashboardSummary, User } from "@/types";

const designApi = vi.hoisted(() => ({
  fetchProjectDashboardSummary: vi.fn(),
  fetchDesignFixtures: vi.fn(),
  reactivateProject: vi.fn(),
  updateProjectModification: vi.fn(),
}));

let mockAuth: {
  user: Partial<User>;
  role: { id: string; name: string };
  access: Record<string, boolean>;
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
  useTasks: () => ({ tasks: [], isLoading: false }),
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
  ExecutiveDashboard: () => <div>Executive Dashboard Surface</div>,
}));

vi.mock("@/components/ControlDesignDashboardWorkspace", () => ({
  ControlDesignDashboardWorkspace: () => <div>Control Design Dedicated Workspace</div>,
}));

vi.mock("@/components/ProjectFixtureOperations", () => ({
  ProjectFixtureOperationsGrid: () => <div>Fixture Operations Grid</div>,
}));

vi.mock("@/components/OverdueAlertModal", () => ({
  OverdueAlertModal: () => null,
}));

vi.mock("@/components/ProjectReactivationDialog", () => ({
  ProjectReactivationDialog: () => null,
}));

vi.mock("@/components/TaskCard", () => ({
  TaskCard: () => <div>Task Card</div>,
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

function setControlDesignAuth() {
  mockAuth = {
    user: buildControlUser({
      subdivision_id: "sub-control-design",
      subdivision: {
        id: "sub-control-design",
        department_id: "control",
        subdivision_name: "Control Design",
        is_active: true,
      },
    }),
    role: { id: "team_leader", name: "Team Leader" },
    access: { ...baseAccess, canAssignTasks: true, canAssignControlDesignProjects: true },
  };
}

function setControlWithoutDesignSubdivisionAuth() {
  mockAuth = {
    user: buildControlUser(),
    role: { id: "team_leader", name: "Team Leader" },
    access: { ...baseAccess, canAssignTasks: true, canApproveCompletedTasks: true, canChangeFixtureStage: true },
  };
}

function setControlOtherSubdivisionAuth() {
  mockAuth = {
    user: buildControlUser({
      subdivision_id: "sub-plc",
      subdivision: {
        id: "sub-plc",
        department_id: "control",
        subdivision_name: "PLC Programming",
        is_active: true,
      },
    }),
    role: { id: "team_leader", name: "Team Leader" },
    access: { ...baseAccess, canAssignTasks: true },
  };
}

function setDesignAuth() {
  mockAuth = {
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
    access: { ...baseAccess },
  };
}

function setExecutiveAuth() {
  mockAuth = {
    user: {
      employee_id: "EMP-ADMIN",
      name: "Admin User",
      department_id: "design",
      department: { id: "design", name: "Design" },
      role_id: "r1",
      role: { id: "r1", name: "Admin", hierarchy_level: 1, permissions: { all: true }, scope: "global" },
      permissions: [],
      is_active: true,
      created_at: "2026-07-01T00:00:00.000Z",
    },
    role: { id: "r1", name: "Admin" },
    access: { ...baseAccess, canViewAllDepartmentsAnalytics: true },
  };
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the executive dashboard for project authority users", async () => {
    setExecutiveAuth();
    renderDashboard();

    expect(await screen.findByText("Executive Dashboard Surface")).toBeInTheDocument();
    expect(designApi.fetchProjectDashboardSummary).not.toHaveBeenCalled();
  });

  it("routes actual Control Design subdivision users to the dedicated workspace", async () => {
    setControlDesignAuth();
    renderDashboard();

    expect(await screen.findByText("Control Design Dedicated Workspace")).toBeInTheDocument();
    expect(screen.queryByText("Native Fixture Upload")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Project Fixtures" })).not.toBeInTheDocument();
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

  it("keeps the existing Project Fixtures workspace for Design users", async () => {
    setDesignAuth();
    renderDashboard();

    expect(await screen.findByText("Native Fixture Upload")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Fixtures" })).toBeInTheDocument();
    expect(screen.getByText("Select a project above to view fixture-level operational status.")).toBeInTheDocument();
    await waitFor(() => expect(designApi.fetchProjectDashboardSummary).toHaveBeenCalledTimes(1));
  });
});