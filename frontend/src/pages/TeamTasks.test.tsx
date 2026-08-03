import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamTasks from "@/pages/TeamTasks";
import type { Task, User } from "@/types";

const designApi = vi.hoisted(() => ({
  fetchProjectDashboardSummary: vi.fn(),
}));

const taskApi = vi.hoisted(() => ({
  approvePendingTasks: vi.fn(),
  updateTask: vi.fn(),
}));

const toastMock = vi.hoisted(() => vi.fn());

let mockAuth: {
  user: Partial<User>;
  access: Record<string, boolean>;
};
let taskState: {
  tasks: Task[];
  isLoading: boolean;
  refreshTasks: ReturnType<typeof vi.fn>;
};

vi.mock("@/api/designApi", () => ({
  fetchProjectDashboardSummary: (...args: unknown[]) => designApi.fetchProjectDashboardSummary(...args),
}));

vi.mock("@/api/taskApi", () => ({
  approvePendingTasks: (...args: unknown[]) => taskApi.approvePendingTasks(...args),
  updateTask: (...args: unknown[]) => taskApi.updateTask(...args),
}));

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/contexts/useTasks", () => ({
  useTasks: () => taskState,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

function pendingTask(id: number, overrides: Partial<Task> = {}) {
  return {
    id,
    title: `Task ${id}`,
    description: `Task ${id} description`,
    task_type: "custom",
    status: "under_review",
    verification_status: "pending",
    approval_stage: "manager",
    priority: "medium",
    deadline: "2026-08-10T00:00:00.000Z",
    due_date: "2026-08-10T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T10:00:00.000Z",
    assigned_to: `EMP-${id}`,
    assignee_ids: [`EMP-${id}`],
    assignee: { employee_id: `EMP-${id}`, name: `Employee ${id}` },
    proof_url: [],
    approval_required: true,
    requires_quality_approval: false,
    project_id: "project-1",
    project_no: "PARC-1",
    project_name: "Press Line",
    fixture_no: "FX-1",
    ...overrides,
  } as Task;
}

function renderTeamTasks(tasks: Task[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  taskState = { tasks, isLoading: false, refreshTasks: vi.fn().mockResolvedValue(undefined) };

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/team-tasks?status=pending_verification"]}>
        <TeamTasks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockAuth = {
    user: { employee_id: "LEAD-1" },
    access: {
      canViewAllTasks: true,
      canViewVerifications: true,
      canApproveCompletedTasks: true,
      canApproveQuality: false,
      canSelfApprove: false,
    },
  };
  designApi.fetchProjectDashboardSummary.mockResolvedValue([]);
  taskApi.updateTask.mockResolvedValue(pendingTask(99, { status: "closed", verification_status: "approved" }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("TeamTasks Approve All", () => {
  it("does not show the button for an empty pending list", () => {
    renderTeamTasks([]);

    expect(screen.queryByRole("button", { name: /approve all/i })).not.toBeInTheDocument();
  });

  it("does not show the button when no pending task is approvable by the user", () => {
    renderTeamTasks([pendingTask(1, { assigned_to: "LEAD-1", assignee_ids: ["LEAD-1"] })]);

    expect(screen.queryByRole("button", { name: /approve all/i })).not.toBeInTheDocument();
  });

  it("confirms once, sends one bulk request, and shows partial failure summary", async () => {
    let resolveApproval: (value: unknown) => void = () => undefined;
    const approvalPromise = new Promise((resolve) => {
      resolveApproval = resolve;
    });
    taskApi.approvePendingTasks.mockReturnValue(approvalPromise);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderTeamTasks([pendingTask(1), pendingTask(2)]);

    const button = await screen.findByRole("button", { name: /approve all/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith("Approve all eligible pending tasks?");
    await waitFor(() => expect(taskApi.approvePendingTasks).toHaveBeenCalledTimes(1));
    expect(taskApi.approvePendingTasks).toHaveBeenCalledWith([1, 2]);
    await waitFor(() => expect(screen.getByRole("button", { name: /approving/i })).toBeDisabled());

    resolveApproval({
      requested_count: 2,
      eligible_count: 2,
      approved_count: 1,
      failed_count: 1,
      skipped_count: 0,
      approved_task_ids: [1],
      results: [
        { task_id: 1, status: "approved" },
        { task_id: 2, status: "failed", message: "Approval failed" },
      ],
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Approve all finished with failures",
        description: "Approved 1 of 2 eligible task(s). 1 failed and remain pending.",
        variant: "destructive",
      }));
    });
  });
});
