import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectFixtureOperationsGrid } from "@/components/ProjectFixtureOperations";
import type { DesignFixtureOption } from "@/types";

const createDesignTask = vi.fn();
const fetchFixtureFullProgress = vi.fn();
const fetchRecentOutsourceSuppliers = vi.fn();
const releaseFixtureWorkflow = vi.fn();
const validateFixtureAssignment = vi.fn();
const fetchTaskAssignmentUsers = vi.fn();
const fetchVerificationTasks = vi.fn();
const refreshTasks = vi.fn();
const toast = vi.fn();
const mockAccess = {
  canAccessProjectFixtures: true,
  canApproveCompletedTasks: false,
  canApproveQuality: false,
  canAssignTasks: true,
  canChangeFixtureStage: true,
  canCreateTasks: true,
  canSelfApprove: false,
  canTransferTasks: false,
  canViewVerifications: false,
};
const mockUser = { employee_id: "MGR-1", department_id: "design" };
const mockTasks: [] = [];
const mockAssignableUsers = [{ employee_id: "DES-1", name: "Designer One" }];

vi.mock("@/api/designApi", () => ({
  bringFixtureInHouse: vi.fn(),
  completeOutsourcedFixture: vi.fn(),
  createDesignTask: (...args: unknown[]) => createDesignTask(...args),
  fetchFixtureFullProgress: (...args: unknown[]) => fetchFixtureFullProgress(...args),
  fetchRecentOutsourceSuppliers: (...args: unknown[]) => fetchRecentOutsourceSuppliers(...args),
  manipulateFixtureStage: vi.fn(),
  outsourceFixture: vi.fn(),
  reopenFixtureStage: vi.fn(),
  releaseFixtureWorkflow: (...args: unknown[]) => releaseFixtureWorkflow(...args),
  validateFixtureAssignment: (...args: unknown[]) => validateFixtureAssignment(...args),
}));

vi.mock("@/api/taskApi", () => ({
  cancelTask: vi.fn(),
  fetchTaskAssignmentUsers: (...args: unknown[]) => fetchTaskAssignmentUsers(...args),
  fetchVerificationTasks: (...args: unknown[]) => fetchVerificationTasks(...args),
  transferTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => ({
    access: mockAccess,
    user: mockUser,
  }),
}));

vi.mock("@/contexts/useTasks", () => ({
  useTasks: () => ({
    tasks: mockTasks,
    refreshTasks,
  }),
}));

vi.mock("@/hooks/queries/useAssignableUsersQuery", () => ({
  useAssignableUsersQuery: () => ({
    data: mockAssignableUsers,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toast(...args),
}));
vi.mock("@/lib/imageUrl", () => ({
  resolveImageUrl: (value: string | null | undefined) => value || "",
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

const fixtureOneDescription = "Inner pipe & outer pipe & RING insertion pressing fixture";

function fixture(overrides: Partial<DesignFixtureOption> = {}): DesignFixtureOption {
  return {
    fixture_id: "fixture-1",
    project_id: "project-1",
    department_id: "design",
    fixture_no: "PARC25016001",
    part_name: fixtureOneDescription,
    fixture_type: "2D00",
    qty: 1,
    is_outsourced: false,
    outsourced_stages: [],
    outsource_status: null,
    is_workflow_complete: false,
    workflow_stage: "Concept",
    workflow_stage_label: "Concept",
    workflow_stage_order: 1,
    workflow_stage_version: 0,
    workflow_revision_code: "CON00",
    workflow_status: "PENDING",
    operational_state: "UNASSIGNED",
    workflow_assigned_to: null,
    workflow_assigned_to_name: null,
    workflow_progress_percent: 0,
    ...overrides,
  };
}

function fixtureProgress() {
  return {
    workflow_name: "Design Workflow",
    revision_no: 0,
    is_legacy_workflow: false,
    revisions: [],
    stages: [
      { stage_name: "Concept", stage_label: "Concept", stage_version: 0, revision_code: "CON00", stage_order: 1, status: "PENDING", assigned_to: null, assigned_at: null, started_at: null, completed_at: null, duration_minutes: null, updated_at: "2026-06-01T00:00:00.000Z", contributions: [] },
      { stage_name: "DAP", stage_label: "DAP", stage_version: 0, revision_code: "DAP00", stage_order: 2, status: "PENDING", assigned_to: null, assigned_at: null, started_at: null, completed_at: null, duration_minutes: null, updated_at: "2026-06-01T00:00:00.000Z", contributions: [] },
      { stage_name: "3D Finish", stage_label: "3D Finish", stage_version: 0, revision_code: "3D00", stage_order: 3, status: "PENDING", assigned_to: null, assigned_at: null, started_at: null, completed_at: null, duration_minutes: null, updated_at: "2026-06-01T00:00:00.000Z", contributions: [] },
      { stage_name: "2D Finish", stage_label: "2D Finish", stage_version: 0, revision_code: "2D00", stage_order: 4, status: "PENDING", assigned_to: null, assigned_at: null, started_at: null, completed_at: null, duration_minutes: null, updated_at: "2026-06-01T00:00:00.000Z", contributions: [] },
      { stage_name: "Release", stage_label: "Release", stage_version: 0, revision_code: "REL00", stage_order: 5, status: "PENDING", assigned_to: null, assigned_at: null, started_at: null, completed_at: null, duration_minutes: null, updated_at: "2026-06-01T00:00:00.000Z", contributions: [] },
    ],
  };
}

function renderGrid(fixtures: DesignFixtureOption[] = [
  fixture(),
  fixture({ fixture_id: "fixture-2", fixture_no: "PARC25016002", part_name: "Inner pipe & outer pipe & Ring insertion Robot fixture" }),
]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectFixtureOperationsGrid fixtures={fixtures} projectId="project-1" departmentId="design" />
    </QueryClientProvider>,
  );
}

async function openAssignPanel() {
  fireEvent.click(screen.getAllByRole("button", { name: "Assign Now" })[0]);
  await waitFor(() => expect(fetchFixtureFullProgress).toHaveBeenCalledWith("fixture-1", "design"));
}

function getWorkflowSelect() {
  const workflowSelect = screen.getAllByRole("combobox").find((select) => (
    within(select).queryByRole("option", { name: /Release \(REL00\) - Pending/i })
  ));

  if (!workflowSelect) {
    throw new Error("Workflow selector not found");
  }

  return workflowSelect;
}

async function selectReleaseWorkflow() {
  await openAssignPanel();
  const workflowSelect = getWorkflowSelect();
  fireEvent.change(workflowSelect, { target: { value: "Release" } });
  return workflowSelect;
}

describe("ProjectFixtureOperations assignment expansion", () => {
  beforeEach(() => {
    fetchFixtureFullProgress.mockResolvedValue(fixtureProgress());
    fetchRecentOutsourceSuppliers.mockResolvedValue([]);
    fetchTaskAssignmentUsers.mockResolvedValue([{ employee_id: "DES-1", name: "Designer One" }]);
    fetchVerificationTasks.mockResolvedValue([]);
    refreshTasks.mockResolvedValue(undefined);
    validateFixtureAssignment.mockResolvedValue({ canAssign: true, reason: null, currentStage: null });
    releaseFixtureWorkflow.mockResolvedValue({
      stage: null,
      stage_label: null,
      stage_version: 0,
      revision_code: null,
      status: "APPROVED",
      stage_order: null,
      is_complete: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("expands the clicked fixture without duplicating fixture number or description", async () => {
    renderGrid();

    await selectReleaseWorkflow();

    expect(screen.getAllByText("PARC25016001")).toHaveLength(1);
    expect(screen.getAllByText(fixtureOneDescription)).toHaveLength(1);
    expect(screen.getAllByText("PARC25016002")).toHaveLength(1);
    expect(getWorkflowSelect()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Release" })).toBeInTheDocument();
  });

  it("collapses the assignment panel when Cancel is clicked", async () => {
    renderGrid([fixture()]);

    await selectReleaseWorkflow();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryAllByRole("combobox")).toHaveLength(0));
  });

  it("moves a successfully released fixture to the completed workflow state without a page reload", async () => {
    renderGrid([fixture()]);

    await selectReleaseWorkflow();
    fireEvent.click(screen.getByRole("button", { name: "Release" }));

    await waitFor(() => expect(releaseFixtureWorkflow).toHaveBeenCalledWith({ fixture_id: "fixture-1", department_id: "design" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Workflow Completed.*1 fixture/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Workflow Completed.*1 fixture/i }));
    expect(await screen.findByRole("button", { name: "Re-Assign" })).toBeInTheDocument();
    expect(screen.getByText("Current Status")).toBeInTheDocument();
    expect(screen.getByText("Released")).toBeInTheDocument();
  });

  it("keeps the panel open and shows the existing error notification when release fails", async () => {
    releaseFixtureWorkflow.mockRejectedValueOnce(new Error("Previous design stages must be approved before Release"));
    renderGrid([fixture()]);

    await selectReleaseWorkflow();
    fireEvent.click(screen.getByRole("button", { name: "Release" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: "Assignment failed",
      description: "Previous design stages must be approved before Release",
      variant: "destructive",
    }));
    expect(screen.getByRole("button", { name: "Release" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workflow Completed.*0 fixtures/i })).toBeInTheDocument();
  });
});