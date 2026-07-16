import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdditionalDesignTaskAssignment } from "@/components/AdditionalDesignTaskAssignment";
import type { User } from "@/types";

const createTask = vi.fn();
const fetchTaskAssignmentUsers = vi.fn();
const fetchProjectDashboardSummary = vi.fn();
const fetchDesignFixtures = vi.fn();

let authUser: Partial<User> = designUser("3D");

vi.mock("@/api/taskApi", () => ({
  createTask: (...args: unknown[]) => createTask(...args),
  fetchTaskAssignmentUsers: (...args: unknown[]) => fetchTaskAssignmentUsers(...args),
}));

vi.mock("@/api/designApi", () => ({
  fetchProjectDashboardSummary: (...args: unknown[]) => fetchProjectDashboardSummary(...args),
  fetchDesignFixtures: (...args: unknown[]) => fetchDesignFixtures(...args),
}));

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => ({
    access: { canAssignTasks: true, canCreateTasks: true },
    user: authUser,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
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

function designUser(team: "2D" | "3D") {
  return {
    employee_id: `LEAD-${team}`,
    name: `${team} Lead`,
    role_id: "leader",
    department_id: "design",
    department: { id: "design", name: "Design", is_active: true },
    subdivision_id: `${team}-subdivision`,
    subdivision: {
      id: `${team}-subdivision`,
      department_id: "design",
      subdivision_name: team,
      is_active: true,
    },
    is_active: true,
    created_at: "2026-06-20T00:00:00.000Z",
  } satisfies Partial<User>;
}

const projectOne = {
  project_id: "project-1",
  project_no: "P-001",
  project_name: "First Project",
  customer_name: "Customer",
  department_id: "design",
  department_name: "Design",
  project_status: "active",
  completion_percent: 0,
};

const projectTwo = {
  ...projectOne,
  project_id: "project-2",
  project_no: "P-002",
  project_name: "Second Project",
};

const completedProject = {
  ...projectOne,
  project_id: "project-completed",
  project_no: "P-003",
  project_name: "Completed Project",
  project_status: "completed",
};

const releasedProject = {
  ...projectOne,
  project_id: "project-released",
  project_no: "P-004",
  project_name: "Released Project",
  project_status: "released",
};

const nonDesignProject = {
  ...projectOne,
  project_id: "project-manufacturing",
  project_no: "M-001",
  project_name: "Manufacturing Project",
  department_id: "manufacturing",
  department_name: "Manufacturing",
};

function employee(employeeId: string, name: string, team: "2D" | "3D", incompleteTaskCount = 0) {
  return {
    employee_id: employeeId,
    name,
    role_id: "designer",
    department_id: "design",
    subdivision: {
      id: `${team}-subdivision`,
      department_id: "design",
      subdivision_name: team,
      is_active: true,
    },
    is_active: true,
    created_at: "2026-06-20T00:00:00.000Z",
    incomplete_task_count: incompleteTaskCount,
  };
}

function renderAssignment() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AdditionalDesignTaskAssignment />
    </QueryClientProvider>,
  );
}

describe("AdditionalDesignTaskAssignment subdivision catalog", () => {
  beforeEach(() => {
    authUser = designUser("3D");
    fetchProjectDashboardSummary.mockResolvedValue([projectOne, projectTwo, completedProject, releasedProject, nonDesignProject]);
    fetchDesignFixtures.mockResolvedValue([{ fixture_id: "fixture-1", fixture_no: "FX-1", part_name: "Fixture One" }]);
    fetchTaskAssignmentUsers.mockResolvedValue([employee("EMP-3D-1", "Alice", "3D", 3)]);
    createTask.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows exactly the Design 3D project task catalog and hides Team and Fixture fields", async () => {
    renderAssignment();

    for (const taskKind of ["Project Process", "Pin Matrix", "PPT", "CBO", "Line Layout", "CDRM", "Print & Drafting Checking"]) {
      expect(await screen.findByRole("option", { name: taskKind })).toBeInTheDocument();
    }

    for (const old2DKind of ["Drafting", "BOM Checking", "Drawing Correction", "AutoCAD PDF", "IGES Data", "CMM Data", "Mimic Display", "Wear-Out Data"]) {
      expect(screen.queryByRole("option", { name: old2DKind })).not.toBeInTheDocument();
    }

    expect(screen.queryByText("Team")).not.toBeInTheDocument();
    expect(screen.queryByText("Fixture")).not.toBeInTheDocument();
  });

  it("keeps Design 2D task types and the existing Team and Fixture fields", async () => {
    authUser = designUser("2D");
    renderAssignment();

    expect(await screen.findByRole("option", { name: "Drafting" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "BOM Checking" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Project Process" })).not.toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Fixture")).toBeInTheDocument();
  });

  it("includes completed and released design projects without showing other departments", async () => {
    renderAssignment();

    expect(await screen.findByRole("option", { name: "P-001 — First Project" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "P-003 — Completed Project" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "P-004 — Released Project" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "M-001 — Manufacturing Project" })).not.toBeInTheDocument();
  });

  it("uses the scoped backend source for Design 3D assignees and saves a project-scope task", async () => {
    renderAssignment();
    await screen.findByRole("option", { name: "P-001 — First Project" });
    const selects = await screen.findAllByRole("combobox");

    fireEvent.change(selects[1], { target: { value: "project-1" } });

    expect(await screen.findByRole("option", { name: "EMP-3D-1 - Alice — 3" })).toBeInTheDocument();
    expect(fetchTaskAssignmentUsers).toHaveBeenLastCalledWith({
      task_type: "additional_design",
      department_id: "design",
      project_id: "project-1",
      stage_name: null,
    });
    expect(fetchDesignFixtures).not.toHaveBeenCalled();

    fireEvent.change(selects[2], { target: { value: "EMP-3D-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Assign Task/ }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      task_type: "additional_design",
      project_id: "project-1",
      assigned_to: "EMP-3D-1",
      additional_task_kind: "Project Process",
      design_team: "3D",
      fixture_id: null,
      scope_type: "project",
      proof_required: false,
    }));
  });

  it("prevents repeated submit clicks while assignment is in progress", async () => {
    createTask.mockImplementation(() => new Promise(() => undefined));
    renderAssignment();
    await screen.findByRole("option", { name: "P-001 — First Project" });
    const selects = await screen.findAllByRole("combobox");

    fireEvent.change(selects[1], { target: { value: "project-1" } });
    expect(await screen.findByRole("option", { name: "EMP-3D-1 - Alice — 3" })).toBeInTheDocument();
    fireEvent.change(selects[2], { target: { value: "EMP-3D-1" } });

    const assignButton = screen.getByRole("button", { name: /Assign Task/ });
    fireEvent.click(assignButton);
    await waitFor(() => expect(assignButton).toBeDisabled());
    fireEvent.click(assignButton);

    expect(createTask).toHaveBeenCalledTimes(1);
  });
  it("keeps the 2D Project Fixtures scoped source", async () => {
    authUser = designUser("2D");
    fetchTaskAssignmentUsers.mockResolvedValue([employee("EMP-2D-1", "Cara", "2D")]);
    renderAssignment();
    await screen.findByRole("option", { name: "P-001 — First Project" });
    const selects = await screen.findAllByRole("combobox");

    fireEvent.change(selects[1], { target: { value: "project-1" } });

    expect(await screen.findByRole("option", { name: "EMP-2D-1 - Cara — Free" })).toBeInTheDocument();
    expect(fetchTaskAssignmentUsers).toHaveBeenLastCalledWith({
      task_type: "department_workflow",
      department_id: "design",
      project_id: "project-1",
      stage_name: "2D Finish",
    });
  });

  it("shows the required empty assignee state and disables assignment when the scoped source is empty", async () => {
    fetchTaskAssignmentUsers.mockResolvedValue([]);
    renderAssignment();
    await screen.findByRole("option", { name: "P-001 — First Project" });
    const selects = await screen.findAllByRole("combobox");

    fireEvent.change(selects[1], { target: { value: "project-1" } });

    expect(await screen.findByText("No eligible assignees in your scope")).toBeInTheDocument();
    await waitFor(() => expect(selects[2]).toBeDisabled());
    expect(screen.getByRole("button", { name: "Assign Task" })).toBeDisabled();
  });
});
