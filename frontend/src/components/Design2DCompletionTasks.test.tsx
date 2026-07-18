import { createContext, useContext, type HTMLAttributes, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Design2DCompletionTasks } from "@/components/Design2DCompletionTasks";
import { toast } from "@/hooks/use-toast";
import { normalizeDesign2DCompletionDeadline } from "@/components/Design2DCompletionDueDate";
import type { Design2DCompletionProjectState, Design2DCompletionTaskCode } from "@/api/designApi";
import type { Task } from "@/types";

const api = vi.hoisted(() => ({
  assignTask: vi.fn(),
  cancelTask: vi.fn(),
  fetchProjects: vi.fn(),
  fetchState: vi.fn(),
  fetchSuppliers: vi.fn(),
  fetchAssignees: vi.fn(),
  transferTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/api/designApi", () => ({
  assignDesign2DCompletionTasks: (...args: unknown[]) => api.assignTask(...args),
  fetchDesign2DCompletionProjects: (...args: unknown[]) => api.fetchProjects(...args),
  fetchDesign2DCompletionProjectState: (...args: unknown[]) => api.fetchState(...args),
  fetchRecentOutsourceSuppliers: (...args: unknown[]) => api.fetchSuppliers(...args),
}));

vi.mock("@/api/taskApi", () => ({
  cancelTask: (...args: unknown[]) => api.cancelTask(...args),
  fetchTaskAssignmentUsers: (...args: unknown[]) => api.fetchAssignees(...args),
  transferTask: (...args: unknown[]) => api.transferTask(...args),
  updateTask: (...args: unknown[]) => api.updateTask(...args),
}));

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => ({
    user: { employee_id: "LEAD-2D", department_id: "design", role_id: "team_leader" },
    access: {
      canAssignTasks: true,
      canCreateTasks: true,
      canApproveCompletedTasks: true,
      canSelfApprove: false,
      canTransferTasks: true,
    },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("@/components/Design2DCompletionDueDate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/Design2DCompletionDueDate")>();
  return {
    ...actual,
    Design2DCompletionDueDatePicker: ({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) => (
      <button type="button" aria-label="Deadline" disabled={disabled} onClick={() => onChange("2026-07-15")}>
        {value ? value.split("-").reverse().join("-") : "Deadline"}
      </button>
    ),
  };
});

vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect?: (date: Date) => void }) => (
    <div role="grid" aria-label="Date-only calendar">
      <button type="button" aria-label="15 July 2026" onClick={() => onSelect?.(new Date(2026, 6, 15))}>15</button>
    </div>
  ),
}));

const SelectContext = createContext<{ value: string; onValueChange?: (value: string) => void }>({ value: "" });

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ value, onValueChange }}><div>{children}</div></SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: HTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => {
    const { value } = useContext(SelectContext);
    return <span>{value || placeholder}</span>;
  },
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }: HTMLAttributes<HTMLButtonElement> & { value: string }) => {
    const select = useContext(SelectContext);
    return <button type="button" role="option" aria-selected={select.value === value} onClick={() => select.onValueChange?.(value)} {...props}>{children}</button>;
  },
}));

const project = {
  project_id: "project-1",
  project_code: "P-001",
  project_name: "Press Line",
  company_name: "Customer",
  department_id: "design",
  project_status: "active" as const,
};

const fixtureDefinitions = [
  ["FIXTURE_DRAFTING_CHECKING", "Drafting Checking"],
  ["FIXTURE_DRAWING_CORRECTION", "Drawing Correction"],
  ["FIXTURE_AUTOCAD_PDF", "AutoCAD PDF"],
  ["FIXTURE_IGES", "IGES"],
].map(([code, displayName]) => ({ code: code as Design2DCompletionTaskCode, displayName, scope: "fixture" as const, required: true }));

const projectDefinitions = [
  ["PROJECT_CMM_DATA", "CMM Data"],
  ["PROJECT_LINE_LAYOUT", "Line Layout"],
  ["PROJECT_MIMIC", "Mimic"],
  ["PROJECT_WEAR_OUT_DATA", "Wear-Out Data"],
].map(([code, displayName]) => ({ code: code as Design2DCompletionTaskCode, displayName, scope: "project" as const, required: code !== "PROJECT_MIMIC" }));

function completionTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Drafting Checking 00",
    task_type: "design_2d_completion",
    description: "Drafting Checking for FX-1",
    assigned_to: "EMP-1",
    assignee_ids: ["EMP-1"],
    assigned_by: "LEAD-2D",
    department_id: "design",
    status: "closed",
    completion_percent: 100,
    verification_status: "approved",
    priority: "medium",
    deadline: "2026-07-20T00:00:00.000Z",
    created_at: "2026-07-14T00:00:00.000Z",
    planned_minutes: 0,
    actual_minutes: 0,
    dependency_ids: [],
    escalation_level: 0,
    requires_quality_approval: false,
    approval_required: true,
    proof_required: true,
    project_id: "project-1",
    project_no: "P-001",
    project_name: "Press Line",
    fixture_id: "fixture-1",
    fixture_no: "FX-1",
    scope_type: "fixture",
    completion_task_code: "FIXTURE_DRAFTING_CHECKING",
    completion_task_revision: 0,
    completion_task_display_name: "Drafting Checking",
    proof_url: ["/proof/drafting.png"],
    ...overrides,
  };
}

function state(tasks: Task[] = [completionTask()]): Design2DCompletionProjectState {
  return {
    project,
    fixtures: [{ fixture_id: "fixture-1", fixture_no: "FX-1", part_name: "Fixture One", workflow_complete: true, two_d_complete: true }],
    tasks,
    fixture_task_types: fixtureDefinitions,
    project_task_types: projectDefinitions,
    all_fixtures_2d_complete: true,
    all_original_workflows_complete: true,
    eligible_fixture_count: 1,
    mandatory_activity_count: 4,
    approved_mandatory_activity_count: 4,
    pending_mandatory_activity_count: 0,
    blocking_fixtures: [],
    fixture_requirements_complete: true,
    project_requirements_complete: true,
    project_tasks_unlocked: true,
    project_completion_ready: true,
    missing_requirements: [],
  };
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><Design2DCompletionTasks departmentId="design" /></QueryClientProvider>);
}

async function selectProject(fixtureCount = 1) {
  fireEvent.click(await screen.findByRole("option", { name: "P-001 — Press Line" }));
  await screen.findByText(`Showing ${fixtureCount} fixture(s) · Customer`);
}

function openFixtureActivities(fixtureNo = "FX-1") {
  fireEvent.click(screen.getByRole("button", { name: `${fixtureNo} activity` }));
}

function checkActivity(label: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(label) }));
}

function completedActivityRow(label: string) {
  return screen.getByText(new RegExp(label)).closest("[data-activity-option]");
}

async function chooseDeadline() {
  fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Deadline" })).toHaveTextContent("15-07-2026"));
}

describe("Design2DCompletionTasks", () => {
  it("rejects invalid 2D completion due dates", () => {
    expect(() => normalizeDesign2DCompletionDeadline("2026-02-30")).toThrow("Deadline date is invalid");
  });
  beforeEach(() => {
    api.fetchProjects.mockResolvedValue([project]);
    api.fetchState.mockResolvedValue(state());
    api.fetchAssignees.mockResolvedValue([{ employee_id: "EMP-1", name: "Designer One" }]);
    api.fetchSuppliers.mockResolvedValue(["Supplier A"]);
    api.assignTask.mockResolvedValue([completionTask()]);
    api.cancelTask.mockResolvedValue(completionTask({ status: "cancelled" }));
    api.transferTask.mockResolvedValue(completionTask());
    api.updateTask.mockResolvedValue(completionTask());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the Project Fixtures board structure without the former assignment and expanded task blocks", async () => {
    renderBoard();
    expect(screen.getByRole("heading", { name: "2D Completion Tasks" })).toBeInTheDocument();
    await selectProject();

    for (const label of ["Unassigned", "Assigned", "In Progress", "Outsourced", "Pending Approval", "Rejected", "Completed", "Cancelled"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("FX-1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Assignment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fixture-level tasks" })).not.toBeInTheDocument();
    expect(screen.getByText("Project-level 2D completion tasks")).toBeInTheDocument();
    expect(api.fetchState).toHaveBeenCalledWith("project-1", "design");
  });

  it("renders an approved 00 option as a green selectable current activity without a fake next revision", async () => {
    api.fetchState.mockResolvedValue(state([completionTask()]));
    renderBoard();
    await selectProject();

    openFixtureActivities();

    const completedRow = completedActivityRow("Drafting Checking 00");
    expect(completedRow).toHaveAttribute("data-completed", "true");
    expect(completedRow).toHaveClass("bg-emerald-600", "text-white");
    expect(screen.getByRole("checkbox", { name: /Drafting Checking 00/ })).not.toBeDisabled();
    expect(screen.queryByText("Create Drafting Checking 01")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select FX-1" })).toBeInTheDocument();
  });

  it("shows one completed fixture activity as 25 percent with no active owner", async () => {
    api.fetchState.mockResolvedValue(state([completionTask({
      title: "AutoCAD PDF 00",
      completion_task_code: "FIXTURE_AUTOCAD_PDF",
      completion_task_display_name: "AutoCAD PDF",
    })]));
    renderBoard();
    await selectProject();

    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("0 assigned")).toBeInTheDocument();
    expect(screen.getByText("1 unassigned")).toBeInTheDocument();
    expect(screen.queryByText("EMP-1")).not.toBeInTheDocument();
  });

  it("shows active assigned activities as read-only chips instead of the selector", async () => {
    api.fetchState.mockResolvedValue(state([completionTask({
      status: "assigned",
      verification_status: "pending",
      completion_percent: 0,
      approved_at: null,
      proof_url: [],
    })]));
    renderBoard();
    await selectProject();

    expect(screen.queryByRole("button", { name: "FX-1 activity" })).not.toBeInTheDocument();
    expect(screen.getByText("Drafting Checking 00")).toBeInTheDocument();
    expect(screen.getByText("1 assigned")).toBeInTheDocument();
  });

  it("does not offer cancellation for backend-completed activities", async () => {
    api.fetchState.mockResolvedValue(state([completionTask()]));
    renderBoard();
    await selectProject();

    expect(screen.queryByRole("button", { name: /Cancel Task/ })).not.toBeInTheDocument();
    openFixtureActivities();
    expect(completedActivityRow("Drafting Checking 00")).toHaveAttribute("data-completed", "true");
  });

  it("cancels the latest active revision once even when approved history is newer", async () => {
    let resolveCancellation: ((task: Task) => void) | undefined;
    api.fetchState.mockResolvedValue(state([
      completionTask({
        id: 1,
        title: "Drafting Checking 00",
        completion_task_revision: 0,
        status: "closed",
        verification_status: "approved",
        completion_percent: 100,
        created_at: "2026-07-16T00:00:00.000Z",
        operational_state: "WORKFLOW_COMPLETE",
      }),
      completionTask({
        id: 2,
        title: "Drafting Checking 01",
        completion_task_revision: 1,
        status: "assigned",
        verification_status: "pending",
        completion_percent: 0,
        approved_at: null,
        proof_url: [],
        created_at: "2026-07-15T00:00:00.000Z",
        operational_state: "WORKFLOW_COMPLETE",
      }),
    ]));
    api.cancelTask.mockReturnValueOnce(new Promise((resolve) => { resolveCancellation = resolve; }));
    renderBoard();
    await selectProject();
    fireEvent.click(screen.getByRole("button", { name: /Cancel Task/ }));
    fireEvent.change(screen.getByPlaceholderText("Cancellation reason"), { target: { value: "Assigned by mistake" } });
    const cancelButton = screen.getByRole("button", { name: "Cancel Activity" });
    await waitFor(() => expect(cancelButton).not.toBeDisabled());
    fireEvent.click(cancelButton);
    fireEvent.click(cancelButton);

    await waitFor(() => expect(api.cancelTask).toHaveBeenCalledTimes(1));
    expect(api.cancelTask).toHaveBeenCalledWith(2, "Assigned by mistake");

    resolveCancellation?.(completionTask({ id: 2, status: "cancelled", completion_task_revision: 1 }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Activity cancelled" })));
  });
  it("keeps the activity dropdown open while multiple fixture activities are checked", async () => {
    api.fetchState.mockResolvedValue(state([]));
    renderBoard();
    await selectProject();

    openFixtureActivities();
    checkActivity("Drafting Checking");
    checkActivity("Drawing Correction");
    checkActivity("IGES");

    expect(screen.getByRole("checkbox", { name: /Drafting Checking/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Drawing Correction/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /IGES/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "FX-1 activity" })).toHaveTextContent("3 activities selected");
  });

  it("keeps project-level activities out of fixture dropdowns but available in the project section", async () => {
    api.fetchState.mockResolvedValue(state([]));
    renderBoard();
    await selectProject();

    openFixtureActivities();
    expect(screen.queryByText("CMM Data")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("button", { name: "Project-level activity" }));
    expect(screen.getByText("CMM Data")).toBeInTheDocument();
    expect(screen.getByText("Line Layout")).toBeInTheDocument();
    expect(screen.getByText("Mimic")).toBeInTheDocument();
    expect(screen.getByText("Wear-Out Data")).toBeInTheDocument();
  });

  it("shows backend blocker counts while no-row eligible fixtures stay visible", async () => {
    api.fetchState.mockResolvedValue({
      ...state([]),
      fixtures: [
        { fixture_id: "fixture-1", fixture_no: "FX-1", part_name: "Fixture One", workflow_complete: true, two_d_complete: true, aggregateSection: "UNASSIGNED", completedMandatoryCount: 2, totalMandatoryCount: 4, progressPercentage: 50, currentActivities: [], activeAssignments: [] },
        { fixture_id: "fixture-2", fixture_no: "FX-2", part_name: "Fixture Two", workflow_complete: true, two_d_complete: true, aggregateSection: "UNASSIGNED", completedMandatoryCount: 3, totalMandatoryCount: 4, progressPercentage: 75, currentActivities: [], activeAssignments: [] },
      ],
      eligible_fixture_count: 2,
      mandatory_activity_count: 8,
      approved_mandatory_activity_count: 5,
      pending_mandatory_activity_count: 3,
      blocking_fixtures: [
        { fixture_id: "fixture-1", fixture_no: "FX-1", pending_activity_count: 2, pending_activities: [] },
        { fixture_id: "fixture-2", fixture_no: "FX-2", pending_activity_count: 1, pending_activities: [] },
      ],
      fixture_requirements_complete: false,
      project_tasks_unlocked: false,
      project_completion_ready: false,
      missing_requirements: ["FX-1: Drafting Checking 00 is incomplete"],
    });
    renderBoard();
    await selectProject(2);

    expect(screen.getByText("Project-level tasks are locked: 3 mandatory fixture activities are pending across 2 fixtures.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project-level activity" })).toBeDisabled();
    expect(screen.getByText("2 unassigned")).toBeInTheDocument();
  });
  it("assigns IGES directly with no Drafting Checking sequence dependency", async () => {
    api.fetchState.mockResolvedValue(state([]));
    renderBoard();
    await selectProject();

    openFixtureActivities();
    checkActivity("IGES");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign Now" }));

    expect(screen.getByText("Selected activities")).toBeInTheDocument();
    expect(screen.getAllByText("IGES").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("option", { name: "EMP-1 — Designer One" }));
    expect(screen.getByRole("button", { name: "Assign 1 Activity" })).toBeDisabled();
    expect(document.querySelector('input[type="datetime-local"], input[type="time"]')).not.toBeInTheDocument();
    await chooseDeadline();
    fireEvent.click(screen.getByRole("option", { name: "High" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign 1 Activity" }));

    await waitFor(() => expect(api.assignTask).toHaveBeenCalledWith(expect.objectContaining({
      project_id: "project-1",
      fixture_id: "fixture-1",
      task_codes: ["FIXTURE_IGES"],
      assigned_to: "EMP-1",
      priority: "high",
      deadline: "2026-07-15T18:30:00.000Z",
    })));
    expect(api.fetchAssignees).toHaveBeenCalledWith(expect.objectContaining({ stage_name: "2D Finish" }));
  });

  it("surfaces the backend message when an assignment request fails", async () => {
    api.fetchState.mockResolvedValue(state([]));
    api.assignTask.mockRejectedValueOnce(new Error("Active project not found or not accessible"));
    renderBoard();
    await selectProject();

    openFixtureActivities();
    checkActivity("IGES");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign Now" }));
    fireEvent.click(screen.getByRole("option", { name: "EMP-1 — Designer One" }));
    await chooseDeadline();
    fireEvent.click(screen.getByRole("button", { name: "Assign 1 Activity" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Assignment failed",
      description: expect.stringContaining("Active project not found or not accessible"),
      variant: "destructive",
    })));
    expect(screen.getByRole("button", { name: "Assign 1 Activity" })).toBeInTheDocument();
  });
  it("uses the same selected business due date for bulk assignment", async () => {
    api.fetchState.mockResolvedValue({
      ...state([]),
      fixtures: [
        { fixture_id: "fixture-1", fixture_no: "FX-1", part_name: "Fixture One", workflow_complete: true, two_d_complete: true },
        { fixture_id: "fixture-2", fixture_no: "FX-2", part_name: "Fixture Two", workflow_complete: true, two_d_complete: true },
      ],
    });
    renderBoard();
    await selectProject(2);

    openFixtureActivities("FX-1");
    checkActivity("Drafting Checking");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    openFixtureActivities("FX-2");
    checkActivity("Drawing Correction");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all eligible fixtures" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign All" }));

    expect(screen.getAllByText("Drafting Checking").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Drawing Correction").length).toBeGreaterThan(0);
    expect(document.querySelector('input[type="datetime-local"], input[type="time"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "EMP-1 — Designer One" }));
    await chooseDeadline();
    fireEvent.click(screen.getAllByRole("button", { name: "Assign All" }).at(-1)!);

    await waitFor(() => expect(api.assignTask).toHaveBeenCalledTimes(2));
    expect(api.assignTask.mock.calls.every(([payload]) => payload.deadline === "2026-07-15T18:30:00.000Z")).toBe(true);
    expect(api.assignTask.mock.calls.map(([payload]) => payload.task_codes)).toEqual([
      ["FIXTURE_DRAFTING_CHECKING"],
      ["FIXTURE_DRAWING_CORRECTION"],
    ]);
  });

  it("prevents duplicate individual assignment submissions", async () => {
    let resolveAssignment: ((tasks: Task[]) => void) | undefined;
    api.fetchState.mockResolvedValue(state([]));
    api.assignTask.mockReturnValueOnce(new Promise((resolve) => { resolveAssignment = resolve; }));
    renderBoard();
    await selectProject();

    openFixtureActivities();
    checkActivity("Drafting Checking");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign Now" }));
    fireEvent.click(screen.getByRole("option", { name: "EMP-1 — Designer One" }));
    await chooseDeadline();
    const assignButton = screen.getByRole("button", { name: "Assign 1 Activity" });
    fireEvent.click(assignButton);
    await waitFor(() => expect(assignButton).toBeDisabled());
    fireEvent.click(assignButton);
    expect(api.assignTask).toHaveBeenCalledTimes(1);

    resolveAssignment?.([completionTask()]);
    await waitFor(() => expect(api.fetchState).toHaveBeenCalledTimes(2));
  });
});
