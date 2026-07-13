import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectFixtureOperationsGrid } from "@/components/ProjectFixtureOperations";
import type { DesignFixtureOption } from "@/types";

const createDesignTask = vi.fn();
const fetchFixtureFullProgress = vi.fn();
const fetchRecentOutsourceSuppliers = vi.fn();
const fetchFixtureReleasePackage = vi.fn();
const fetchProjectOutsourceAssignments = vi.fn();
const bulkOutsourceDialogProps = vi.fn();
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
const mockUser = { employee_id: "MGR-1", department_id: "design", permissions: [] as string[] };
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

vi.mock("@/api/releaseDeliverablesApi", () => ({
  assignFixtureReleaseDeliverable: vi.fn(),
  fetchFixtureReleasePackage: (...args: unknown[]) => fetchFixtureReleasePackage(...args),
  reviewFixtureReleaseDeliverable: vi.fn(),
  setMimicReleaseDeliverableApplicability: vi.fn(),
  startFixtureReleaseDeliverable: vi.fn(),
  submitFixtureReleaseDeliverable: vi.fn(),
}));

vi.mock("@/api/outsourceAssignmentsApi", () => ({
  fetchProjectOutsourceAssignments: (...args: unknown[]) => fetchProjectOutsourceAssignments(...args),
}));

vi.mock("@/components/BulkOutsourceDialog", () => ({
  BulkOutsourceDialog: (props: Record<string, unknown>) => {
    bulkOutsourceDialogProps(props);
    return props.open ? <div data-testid="bulk-outsource-dialog">{String(props.scope)} · {String(props.workflowStage)}</div> : null;
  },
}));

vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect?: (date: Date) => void }) => (
    <button type="button" onClick={() => onSelect?.(new Date(2026, 6, 31))}>Choose July 31</button>
  ),
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
], options: { readOnly?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectFixtureOperationsGrid
        fixtures={fixtures}
        projectId="project-1"
        departmentId="design"
        readOnly={options.readOnly}
      />
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
    mockUser.permissions = [];
    fetchProjectOutsourceAssignments.mockResolvedValue([]);
    fetchFixtureFullProgress.mockResolvedValue(fixtureProgress());
    fetchRecentOutsourceSuppliers.mockResolvedValue([]);
    fetchFixtureReleasePackage.mockResolvedValue({
      release_package: null,
      statuses: {
        main_workflow: { code: "COMPLETED", label: "Completed" },
        release_deliverables: { code: "COMPLETE", label: "Complete", approved: 9, total: 9 },
        release: { code: "READY_FOR_RELEASE", label: "Ready for Release" },
      },
      blockers: [],
      available_actions: ["RELEASE"],
    });
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

  it("moves a successfully released fixture to a visible read-only completed state without a page reload", async () => {
    renderGrid([fixture()]);

    await selectReleaseWorkflow();
    fireEvent.click(screen.getByRole("button", { name: "Release" }));

    await waitFor(() => expect(releaseFixtureWorkflow).toHaveBeenCalledWith({ fixture_id: "fixture-1", department_id: "design" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Workflow Completed.*1 fixture/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Workflow Completed.*1 fixture/i }));
    expect(screen.queryByRole("button", { name: "Re-Assign" })).not.toBeInTheDocument();
    expect(screen.getByText("Current Status")).toBeInTheDocument();
    expect(screen.getByText("Released", { selector: "p" })).toBeInTheDocument();
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

  it("renders terminal project fixtures read-only with every mutation action hidden", () => {
    renderGrid([
      fixture(),
      fixture({
        fixture_id: "fixture-outsourced",
        fixture_no: "PARC25016003",
        is_outsourced: true,
        outsourced_stages: ["Concept"],
        outsource_status: "outsourced",
      }),
    ], { readOnly: true });

    expect(screen.getByText("PARC25016001")).toBeInTheDocument();
    expect(screen.getByText("PARC25016003")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign All" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign Now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Outsource" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Completed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bring In-House" })).not.toBeInTheDocument();
    expect(fetchTaskAssignmentUsers).not.toHaveBeenCalled();
    expect(fetchRecentOutsourceSuppliers).not.toHaveBeenCalled();
  });
  it("keeps completed and released fixtures visible and filters by backend release state", async () => {
    renderGrid([
      fixture({ fixture_id: "active", fixture_no: "WF-ACTIVE", fixture_release_state: "WORKFLOW_ACTIVE" }),
      fixture({ fixture_id: "pending", fixture_no: "WF-PENDING", fixture_release_state: "PENDING_DELIVERABLES" }),
      fixture({ fixture_id: "ready", fixture_no: "WF-READY", fixture_release_state: "READY_FOR_RELEASE" }),
      fixture({
        fixture_id: "released",
        fixture_no: "WF-RELEASED",
        fixture_release_state: "RELEASED",
        is_workflow_complete: true,
        operational_state: "WORKFLOW_COMPLETE",
      }),
    ]);

    expect(screen.getByText("WF-ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("WF-PENDING")).toBeInTheDocument();
    expect(screen.getByText("WF-READY")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workflow Completed.*1 fixture/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pending Deliverables" }));
    expect(screen.getByText("WF-PENDING")).toBeInTheDocument();
    expect(screen.queryByText("WF-ACTIVE")).not.toBeInTheDocument();
    expect(screen.queryByText("WF-READY")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ready for Release" }));
    expect(screen.getByText("WF-READY")).toBeInTheDocument();
    expect(screen.queryByText("WF-PENDING")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Workflow Active" }));
    expect(screen.getByText("WF-ACTIVE")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Released" }));
    const completedSection = screen.getByRole("button", { name: /Workflow Completed.*1 fixture/i });
    fireEvent.click(completedSection);
    expect(await screen.findByText("WF-RELEASED")).toBeInTheDocument();
  });

  it("uses one shared scope for all-assignable outsourcing", async () => {
    mockUser.permissions = ["design.fixture.outsource", "design.fixture.outsource.bulk"];
    renderGrid();

    fireEvent.click(screen.getByRole("button", { name: "Assign All" }));
    const outsourceButton = await screen.findByRole("button", { name: "Outsource" });
    await waitFor(() => expect(outsourceButton).toBeEnabled());
    fireEvent.click(outsourceButton);

    expect(await screen.findByTestId("bulk-outsource-dialog")).toHaveTextContent("all_assignable · Concept");
    const props = bulkOutsourceDialogProps.mock.calls.at(-1)?.[0];
    expect(props).toEqual(expect.objectContaining({
      open: true,
      scope: "all_assignable",
      fixtureIds: [],
      workflowStage: "Concept",
      requestedCount: 2,
    }));
  });

  it("uses selected fixture ids and the selected workflow for outsourcing", async () => {
    mockUser.permissions = ["design.fixture.outsource", "design.fixture.outsource.bulk"];
    renderGrid();

    fireEvent.click(screen.getByRole("button", { name: "Assign All" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select PARC25016001" }));
    fireEvent.change(getWorkflowSelect(), { target: { value: "DAP" } });
    fireEvent.click(screen.getByRole("button", { name: "Outsource" }));

    expect(await screen.findByTestId("bulk-outsource-dialog")).toHaveTextContent("selected · DAP");
    const props = bulkOutsourceDialogProps.mock.calls.at(-1)?.[0];
    expect(props).toEqual(expect.objectContaining({
      open: true,
      scope: "selected",
      fixtureIds: ["fixture-1"],
      workflowStage: "DAP",
      requestedCount: 1,
    }));
  });

  it("keeps outsourcing actions hidden without backend-granted permissions", async () => {
    renderGrid();

    fireEvent.click(screen.getByRole("button", { name: "Assign All" }));
    await waitFor(() => expect(fetchFixtureFullProgress).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Outsource" })).not.toBeInTheDocument();
  });

  it("preserves the existing Assign All task-assignment flow", async () => {
    renderGrid();

    fireEvent.click(screen.getByRole("button", { name: "Assign All" }));
    await waitFor(() => expect(fetchFixtureFullProgress).toHaveBeenCalledTimes(2));
    const employeeSelect = screen.getAllByRole("combobox").find((select) => (
      within(select).queryByRole("option", { name: /Designer One/i })
    ));
    if (!employeeSelect) throw new Error("Employee selector not found");
    fireEvent.change(employeeSelect, { target: { value: "DES-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose July 31" }));

    const assignButtons = screen.getAllByRole("button", { name: "Assign All" });
    fireEvent.click(assignButtons[assignButtons.length - 1]);

    await waitFor(() => expect(createDesignTask).toHaveBeenCalledTimes(2));
    expect(createDesignTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      fixture_id: "fixture-1",
      assigned_to: "DES-1",
    }));
    expect(createDesignTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      fixture_id: "fixture-2",
      assigned_to: "DES-1",
    }));
  });
});
