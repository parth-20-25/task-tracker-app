import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Design2DCompletionTasks } from "@/components/Design2DCompletionTasks";
import type { Design2DCompletionProjectState } from "@/api/designApi";
import type { Task } from "@/types";

const api = vi.hoisted(() => ({
  assignTask: vi.fn(),
  fetchProjects: vi.fn(),
  fetchState: vi.fn(),
  fetchSuppliers: vi.fn(),
  fetchAssignees: vi.fn(),
  markNotRequired: vi.fn(),
  transferTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/api/designApi", () => ({
  assignDesign2DCompletionTask: (...args: unknown[]) => api.assignTask(...args),
  fetchDesign2DCompletionProjects: (...args: unknown[]) => api.fetchProjects(...args),
  fetchDesign2DCompletionProjectState: (...args: unknown[]) => api.fetchState(...args),
  fetchRecentOutsourceSuppliers: (...args: unknown[]) => api.fetchSuppliers(...args),
  markDesign2DMimicNotRequired: (...args: unknown[]) => api.markNotRequired(...args),
}));

vi.mock("@/api/taskApi", () => ({
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

vi.mock("@/contexts/useTasks", () => ({
  useTasks: () => ({
    cancelTask: vi.fn(),
    executeTaskAction: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: {
    children: ReactNode;
    value: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select value={value} disabled={disabled} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value, disabled }: { children: ReactNode; value: string; disabled?: boolean }) => (
    <option value={value} disabled={disabled}>{children}</option>
  ),
}));

const project = {
  project_id: "project-1",
  project_code: "P-001",
  project_name: "Press Line",
  company_name: "Customer",
  department_id: "design",
  project_status: "active" as const,
};

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
    proof_url: ["/proof/drafting.pdf"],
    ...overrides,
  };
}

function state(tasks: Task[] = [completionTask()]): Design2DCompletionProjectState {
  return {
    project,
    fixtures: [{
      fixture_id: "fixture-1",
      fixture_no: "FX-1",
      part_name: "Fixture One",
      workflow_complete: true,
      two_d_complete: true,
    }],
    tasks,
    fixture_task_types: [
      { code: "FIXTURE_DRAFTING_CHECKING", displayName: "Drafting Checking", scope: "fixture", required: true },
      { code: "FIXTURE_DRAWING_CORRECTION", displayName: "Drawing Correction", scope: "fixture", required: true },
      { code: "FIXTURE_AUTOCAD_PDF", displayName: "AutoCAD PDF", scope: "fixture", required: true },
      { code: "FIXTURE_IGES", displayName: "IGES", scope: "fixture", required: true },
    ],
    project_task_types: [
      { code: "PROJECT_CMM_DATA", displayName: "CMM Data", scope: "project", required: true },
      { code: "PROJECT_LINE_LAYOUT", displayName: "Line Layout", scope: "project", required: true },
      { code: "PROJECT_MIMIC", displayName: "Mimic", scope: "project", required: false },
      { code: "PROJECT_WEAR_OUT_DATA", displayName: "Wear-Out Data", scope: "project", required: true },
    ],
    all_fixtures_2d_complete: true,
    all_original_workflows_complete: true,
    fixture_requirements_complete: true,
    project_tasks_unlocked: true,
    project_completion_ready: false,
    missing_requirements: ["CMM Data", "Line Layout", "Mimic", "Wear-Out Data"],
  };
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Design2DCompletionTasks departmentId="design" />
    </QueryClientProvider>,
  );
}

async function selectProject() {
  await screen.findByRole("option", { name: "P-001 — Press Line" });
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "project-1" } });
}

describe("Design2DCompletionTasks", () => {
  beforeEach(() => {
    api.fetchProjects.mockResolvedValue([project]);
    api.fetchState.mockResolvedValue(state());
    api.fetchAssignees.mockResolvedValue([{ employee_id: "EMP-1", name: "Designer One" }]);
    api.fetchSuppliers.mockResolvedValue(["Supplier A"]);
    api.assignTask.mockResolvedValue(completionTask({ id: 20, title: "Drawing Correction 00" }));
    api.markNotRequired.mockResolvedValue(completionTask({ id: 30, title: "Mimic 00", fixture_id: null, scope_type: "project" }));
    api.transferTask.mockResolvedValue(completionTask());
    api.updateTask.mockResolvedValue(completionTask());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("has an independent eligible-project dropdown and renders fixture and project assignment cards", async () => {
    renderSection();

    expect(screen.getByRole("heading", { name: "2D Completion Tasks" })).toBeInTheDocument();
    await selectProject();

    expect(await screen.findByRole("heading", { name: "Fixture-level tasks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "FX-1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project-level tasks" })).toBeInTheDocument();
    expect(screen.getAllByText("Project-level task")).toHaveLength(4);
    expect(screen.getByText("These tasks belong once to the complete project and have no fixture ID.")).toBeInTheDocument();
    expect(api.fetchState).toHaveBeenCalledWith("project-1", "design");
  });

  it("assigns fixture and project tasks with distinct scope payloads through the shared assignee source", async () => {
    renderSection();
    await selectProject();
    await screen.findByRole("heading", { name: "Fixture-level tasks" });
    let selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[3], { target: { value: "EMP-1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Assign Now" })[0]);

    await waitFor(() => expect(api.assignTask).toHaveBeenCalledWith(expect.objectContaining({
      project_id: "project-1",
      fixture_id: "fixture-1",
      task_code: "FIXTURE_DRAFTING_CHECKING",
      assigned_to: "EMP-1",
    })));
    expect(api.fetchAssignees).toHaveBeenCalledWith(expect.objectContaining({
      task_type: "department_workflow",
      project_id: "project-1",
      stage_name: "2D Finish",
    }));

    selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "PROJECT_CMM_DATA" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Assign Now" })[0]);
    await waitFor(() => expect(api.assignTask).toHaveBeenLastCalledWith(expect.objectContaining({
      fixture_id: null,
      task_code: "PROJECT_CMM_DATA",
    })));
  });

  it("keeps completed 00 green and shows a later 01 revision without replacing history", async () => {
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
      }),
    ]));
    renderSection();
    await selectProject();

    const completedName = await screen.findByText("Drafting Checking 00");
    expect(completedName.closest("[class*='border-success']")).not.toBeNull();
    expect(screen.getByText("Drafting Checking 01")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });
});
