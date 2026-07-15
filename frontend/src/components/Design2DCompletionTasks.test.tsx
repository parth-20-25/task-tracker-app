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
  assignDesign2DCompletionTask: (...args: unknown[]) => api.assignTask(...args),
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

const definitions = [
  ["FIXTURE_DRAFTING_CHECKING", "Drafting Checking"],
  ["FIXTURE_DRAWING_CORRECTION", "Drawing Correction"],
  ["FIXTURE_AUTOCAD_PDF", "AutoCAD PDF"],
  ["FIXTURE_IGES", "IGES"],
  ["PROJECT_CMM_DATA", "CMM Data"],
  ["PROJECT_LINE_LAYOUT", "Line Layout"],
  ["PROJECT_MIMIC", "Mimic"],
  ["PROJECT_WEAR_OUT_DATA", "Wear-Out Data"],
].map(([code, displayName]) => ({ code: code as Design2DCompletionTaskCode, displayName, scope: "fixture" as const, required: false }));

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
    fixture_task_types: definitions,
    project_task_types: [],
    all_fixtures_2d_complete: true,
    all_original_workflows_complete: true,
    fixture_requirements_complete: true,
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

describe("Design2DCompletionTasks", () => {
  it("rejects invalid 2D completion due dates", () => {
    expect(() => normalizeDesign2DCompletionDeadline("2026-02-30")).toThrow("Deadline date is invalid");
  });
  beforeEach(() => {
    api.fetchProjects.mockResolvedValue([project]);
    api.fetchState.mockResolvedValue(state());
    api.fetchAssignees.mockResolvedValue([{ employee_id: "EMP-1", name: "Designer One" }]);
    api.fetchSuppliers.mockResolvedValue(["Supplier A"]);
    api.assignTask.mockResolvedValue(completionTask());
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

    for (const label of ["Unassigned", "Assigned", "In Progress", "Outsourced", "Verification", "Rejected", "Workflow Complete", "Cancelled"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("FX-1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Assignment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fixture-level tasks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Project-level tasks" })).not.toBeInTheDocument();
    expect(api.fetchState).toHaveBeenCalledWith("project-1", "design");
  });

  it("renders an approved 00 option and the selected trigger fully green from backend status", async () => {
    api.fetchState.mockResolvedValue(state([
      completionTask(),
      completionTask({
        id: 2,
        title: "Drafting Checking 01",
        completion_task_revision: 1,
        status: "assigned",
        completion_percent: 0,
        verification_status: "pending",
        proof_url: [],
        created_at: "2026-07-15T00:00:00.000Z",
      }),
    ]));
    renderBoard();
    await selectProject();

    const completedOption = screen.getByRole("option", { name: "Drafting Checking 00" });
    expect(completedOption).toHaveAttribute("data-completed", "true");
    expect(completedOption).toHaveClass("bg-emerald-600", "text-white");
    fireEvent.click(completedOption);

    await waitFor(() => {
      const trigger = screen.getByRole("button", { name: "FX-1 activity" });
      expect(trigger).toHaveAttribute("data-completed", "true");
      expect(trigger).toHaveClass("bg-emerald-600", "text-white");
    });
  });

  it("does not offer cancellation for backend-completed activities", async () => {
    api.fetchState.mockResolvedValue(state([
      completionTask({
        status: "assigned",
        verification_status: "pending",
        completion_percent: 0,
        approved_at: "2026-07-15T00:00:00.000Z",
        operational_state: "WORKFLOW_COMPLETE",
      }),
    ]));
    renderBoard();
    await selectProject();

    expect(screen.queryByRole("button", { name: /Cancel Task/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "FX-1 activity" })).toHaveAttribute("data-completed", "true");
  });
  it("assigns IGES 00 directly with no Drafting Checking sequence dependency", async () => {
    api.fetchState.mockResolvedValue(state([]));
    renderBoard();
    await selectProject();
    fireEvent.click(screen.getByRole("option", { name: "IGES 00" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign Now" }));
    fireEvent.click(screen.getByRole("option", { name: "EMP-1 — Designer One" }));
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
    expect(document.querySelector('input[type="datetime-local"], input[type="time"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
    fireEvent.click(await screen.findByRole("button", { name: "15 July 2026" }));
    expect(screen.getByRole("button", { name: "Deadline" })).toHaveTextContent("15-07-2026");
    fireEvent.click(screen.getByRole("option", { name: "High" }));
    expect(screen.getByRole("button", { name: "Deadline" })).toHaveTextContent("15-07-2026");
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(api.assignTask).toHaveBeenCalledWith(expect.objectContaining({
      project_id: "project-1",
      fixture_id: "fixture-1",
      task_code: "FIXTURE_IGES",
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

    fireEvent.click(screen.getByRole("option", { name: "IGES 00" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign Now" }));
    fireEvent.click(screen.getByRole("option", { name: "EMP-1 — Designer One" }));
    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
    fireEvent.click(await screen.findByRole("button", { name: "15 July 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Assignment failed",
      description: expect.stringContaining("Active project not found or not accessible"),
      variant: "destructive",
    })));
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all eligible fixtures" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign All" }));
    expect(document.querySelector('input[type="datetime-local"], input[type="time"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "EMP-1 — Designer One" }));
    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
    fireEvent.click(await screen.findByRole("button", { name: "15 July 2026" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Assign All" }).at(-1)!);

    await waitFor(() => expect(api.assignTask).toHaveBeenCalledTimes(2));
    expect(api.assignTask.mock.calls.every(([payload]) => payload.deadline === "2026-07-15T18:30:00.000Z")).toBe(true);
  });

  it("prevents duplicate individual assignment submissions", async () => {
    let resolveAssignment: ((task: Task) => void) | undefined;
    api.fetchState.mockResolvedValue(state([]));
    api.assignTask.mockReturnValueOnce(new Promise((resolve) => { resolveAssignment = resolve; }));
    renderBoard();
    await selectProject();

    fireEvent.click(screen.getByRole("button", { name: "Assign Now" }));
    fireEvent.click(screen.getByRole("option", { name: "EMP-1 — Designer One" }));
    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
    fireEvent.click(await screen.findByRole("button", { name: "15 July 2026" }));
    const assignButton = screen.getByRole("button", { name: "Assign" });
    fireEvent.click(assignButton);
    await waitFor(() => expect(assignButton).toBeDisabled());
    fireEvent.click(assignButton);
    expect(api.assignTask).toHaveBeenCalledTimes(1);

    resolveAssignment?.(completionTask());
    await waitFor(() => expect(api.fetchState).toHaveBeenCalledTimes(2));
  });
});
