import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdditionalDesignTaskAssignment } from "@/components/AdditionalDesignTaskAssignment";

const fetchTaskAssignmentUsers = vi.fn();
const fetchProjectDashboardSummary = vi.fn();
const fetchDesignFixtures = vi.fn();

vi.mock("@/api/taskApi", () => ({
  createTask: vi.fn(),
  fetchTaskAssignmentUsers: (...args: unknown[]) => fetchTaskAssignmentUsers(...args),
}));

vi.mock("@/api/designApi", () => ({
  fetchProjectDashboardSummary: (...args: unknown[]) => fetchProjectDashboardSummary(...args),
  fetchDesignFixtures: (...args: unknown[]) => fetchDesignFixtures(...args),
}));

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => ({
    access: { canAssignTasks: true, canCreateTasks: true },
    user: { employee_id: "LEAD-1", department_id: "design" },
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

function employee(employeeId: string, name: string, team: "2D" | "3D") {
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
    incomplete_task_count: 0,
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

describe("AdditionalDesignTaskAssignment assignee scope", () => {
  beforeEach(() => {
    fetchProjectDashboardSummary.mockResolvedValue([projectOne, projectTwo, completedProject, releasedProject, nonDesignProject]);
    fetchDesignFixtures.mockResolvedValue([]);
    fetchTaskAssignmentUsers.mockImplementation(async ({ project_id, stage_name }) => {
      if (project_id === "project-1") {
        return [
          employee("EMP-3D-1", "Alice", "3D"),
          employee("EMP-2D-OTHER", "Other Team", "2D"),
        ];
      }

      if (stage_name === "2D Finish") {
        return [employee("EMP-2D-2", "Cara", "2D")];
      }

      return [employee("EMP-3D-2", "Bob", "3D")];
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });


  it("includes completed and released design projects without showing other departments", async () => {
    renderAssignment();

    expect(await screen.findByRole("option", { name: "P-001 — First Project" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "P-003 — Completed Project" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "P-004 — Released Project" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "M-001 — Manufacturing Project" })).not.toBeInTheDocument();
  });

  it("uses the Project Fixtures scoped source directly and refreshes for project and team changes", async () => {
    renderAssignment();
    await screen.findByRole("option", { name: "P-001 — First Project" });
    const selects = await screen.findAllByRole("combobox");
    const projectSelect = selects[1];
    const teamSelect = selects[3];

    fireEvent.change(projectSelect, { target: { value: "project-1" } });

    expect(await screen.findByRole("option", { name: "EMP-3D-1 - Alice — Free" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "EMP-2D-OTHER - Other Team — Free" })).toBeInTheDocument();
    expect(fetchTaskAssignmentUsers).toHaveBeenLastCalledWith({
      task_type: "department_workflow",
      department_id: "design",
      project_id: "project-1",
      stage_name: null,
    });
    expect(fetchDesignFixtures).toHaveBeenCalledWith("project-1", "design");

    fireEvent.change(projectSelect, { target: { value: "project-2" } });

    expect(await screen.findByRole("option", { name: "EMP-3D-2 - Bob — Free" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Alice/ })).not.toBeInTheDocument();

    fireEvent.change(teamSelect, { target: { value: "2D" } });

    expect(await screen.findByRole("option", { name: "EMP-2D-2 - Cara — Free" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Bob/ })).not.toBeInTheDocument();
    expect(fetchTaskAssignmentUsers).toHaveBeenLastCalledWith({
      task_type: "department_workflow",
      department_id: "design",
      project_id: "project-2",
      stage_name: "2D Finish",
    });
  });

  it("shows the required empty state and disables assignment when the scoped source is empty", async () => {
    fetchTaskAssignmentUsers.mockResolvedValue([]);
    renderAssignment();
    await screen.findByRole("option", { name: "P-001 — First Project" });
    const selects = await screen.findAllByRole("combobox");

    fireEvent.change(selects[1], { target: { value: "project-1" } });

    expect(await screen.findByText("No eligible assignees in your scope")).toBeInTheDocument();
    await waitFor(() => expect(selects[4]).toBeDisabled());
    expect(screen.getByRole("button", { name: "Assign Task" })).toBeDisabled();
  });
});
