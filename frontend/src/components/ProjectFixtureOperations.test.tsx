import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectFixtureOperationsGrid } from "@/components/ProjectFixtureOperations";
import type { DesignFixtureOption } from "@/types";

const bulkOutsourceFixtures = vi.fn();
const createDesignTask = vi.fn();
const fetchFixtureFullProgress = vi.fn();
const fetchRecentOutsourceSuppliers = vi.fn();
const outsourceFixture = vi.fn();
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
  bulkOutsourceFixtures: (...args: unknown[]) => bulkOutsourceFixtures(...args),
  completeOutsourcedFixture: vi.fn(),
  createDesignTask: (...args: unknown[]) => createDesignTask(...args),
  fetchFixtureFullProgress: (...args: unknown[]) => fetchFixtureFullProgress(...args),
  fetchRecentOutsourceSuppliers: (...args: unknown[]) => fetchRecentOutsourceSuppliers(...args),
  manipulateFixtureStage: vi.fn(),
  outsourceFixture: (...args: unknown[]) => outsourceFixture(...args),
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
], projectId = "project-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <ProjectFixtureOperationsGrid fixtures={fixtures} projectId={projectId} departmentId="design" />
      </QueryClientProvider>,
    ),
    queryClient,
  };
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
    outsourceFixture.mockResolvedValue(fixture({ is_outsourced: true, outsource_status: "outsourced" }));
    bulkOutsourceFixtures.mockImplementation(async ({ fixtureIds }: { fixtureIds: string[] }) => ({
      requested: fixtureIds.length,
      succeeded: fixtureIds.length,
      failed: 0,
      results: fixtureIds.map((fixtureId) => ({ fixtureId, success: true })),
    }));
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

  it("keeps individual Outsource on the shared dialog and existing API", async () => {
    renderGrid([fixture()]);

    fireEvent.click(screen.getByRole("button", { name: "Outsource" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Selected project:");
    expect(screen.getByRole("dialog")).toHaveTextContent("project-1");
    expect(screen.getByRole("dialog")).toHaveTextContent("Fixtures: 1");
    expect(screen.getByRole("dialog")).toHaveTextContent("fixture-1");

    fireEvent.change(screen.getByLabelText("Supplier Name"), { target: { value: "Supplier X" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Concept" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Outsource" }));

    await waitFor(() => expect(outsourceFixture).toHaveBeenCalledWith("fixture-1", {
      department_id: "design",
      supplier_name: "Supplier X",
      outsourced_stages: ["Concept"],
    }));
    expect(bulkOutsourceFixtures).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("selects only outsource-eligible fixtures and keeps Assign All selection independent", async () => {
    renderGrid([
      fixture(),
      fixture({ fixture_id: "fixture-2", fixture_no: "PARC25016002", part_name: "Fixture two" }),
      fixture({
        fixture_id: "fixture-active",
        fixture_no: "PARC25016003",
        part_name: "Already outsourced",
        is_outsourced: true,
        outsource_status: "outsourced",
        outsourced_stages: ["Concept"],
      }),
    ]);

    const firstOutsourceCheckbox = screen.getByRole("checkbox", { name: "Select PARC25016001 for outsourcing" });
    fireEvent.click(firstOutsourceCheckbox);
    expect(screen.getByRole("checkbox", { name: "Select all eligible fixtures" })).toHaveAttribute("data-state", "indeterminate");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all eligible fixtures" }));
    expect(screen.getByRole("button", { name: "Outsource Selected (2)" })).toBeEnabled();
    expect(screen.queryByRole("checkbox", { name: "Select PARC25016003 for outsourcing" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Assign All" }));
    expect(screen.getByRole("checkbox", { name: "Select PARC25016001" })).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByRole("button", { name: "Outsource Selected (2)" })).toBeEnabled();
  });

  it("clears outsource selection when the selected project changes", async () => {
    const view = renderGrid([fixture()]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select PARC25016001 for outsourcing" }));
    expect(screen.getByRole("button", { name: "Outsource Selected (1)" })).toBeEnabled();

    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <ProjectFixtureOperationsGrid
          fixtures={[fixture({ fixture_id: "fixture-project-2", project_id: "project-2", fixture_no: "PARC25026001" })]}
          projectId="project-2"
          departmentId="design"
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Outsource Selected (0)" })).toBeDisabled());
  });

  it("shows partial failures and keeps failed eligible fixtures selected for retry", async () => {
    bulkOutsourceFixtures.mockResolvedValueOnce({
      requested: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { fixtureId: "fixture-1", success: true },
        {
          fixtureId: "fixture-2",
          success: false,
          code: "OUTSOURCE_FAILED",
          message: "Supplier integration unavailable",
        },
      ],
    });
    renderGrid([
      fixture(),
      fixture({ fixture_id: "fixture-2", fixture_no: "PARC25016002", part_name: "Fixture two" }),
    ]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all eligible fixtures" }));
    fireEvent.click(screen.getByRole("button", { name: "Outsource Selected (2)" }));
    fireEvent.change(screen.getByLabelText("Supplier Name"), { target: { value: "Supplier X" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Concept" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Outsource" }));

    await waitFor(() => expect(bulkOutsourceFixtures).toHaveBeenCalledWith({
      projectId: "project-1",
      fixtureIds: ["fixture-1", "fixture-2"],
      outsourceData: {
        department_id: "design",
        supplier_name: "Supplier X",
        outsourced_stages: ["Concept"],
      },
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent("fixture-2");
    expect(screen.getByRole("alert")).toHaveTextContent("Supplier integration unavailable");
    expect(screen.getByRole("dialog")).toHaveTextContent("Fixtures: 1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Outsource Selected (1)" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Select PARC25016001 for outsourcing" })).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByRole("checkbox", { name: "Select PARC25016002 for outsourcing" })).toHaveAttribute("data-state", "checked");
  });

  it("prevents duplicate bulk outsource submissions", async () => {
    let resolveBulk: ((value: {
      requested: number;
      succeeded: number;
      failed: number;
      results: Array<{ fixtureId: string; success: boolean }>;
    }) => void) | undefined;
    bulkOutsourceFixtures.mockReturnValueOnce(new Promise((resolve) => {
      resolveBulk = resolve;
    }));
    renderGrid([fixture()]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select PARC25016001 for outsourcing" }));
    fireEvent.click(screen.getByRole("button", { name: "Outsource Selected (1)" }));
    fireEvent.change(screen.getByLabelText("Supplier Name"), { target: { value: "Supplier X" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Concept" }));

    const confirmButton = screen.getByRole("button", { name: "Confirm Outsource" });
    fireEvent.click(confirmButton);
    await waitFor(() => expect(confirmButton).toBeDisabled());
    fireEvent.click(confirmButton);
    expect(bulkOutsourceFixtures).toHaveBeenCalledTimes(1);

    resolveBulk?.({
      requested: 1,
      succeeded: 1,
      failed: 0,
      results: [{ fixtureId: "fixture-1", success: true }],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });});