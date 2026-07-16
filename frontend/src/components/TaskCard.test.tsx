import { act, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCard } from "@/components/TaskCard";
import type { Task } from "@/types";

const executeTaskAction = vi.fn();
const cancelTask = vi.fn();
const toast = vi.fn();

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => ({
    user: { employee_id: "EMP-3D-1", id: "user-3d-1", is_active: true },
  }),
}));

vi.mock("@/contexts/useTasks", () => ({
  useTasks: () => ({
    executeTaskAction,
    cancelTask,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toast(...args),
}));

vi.mock("@/components/TaskExecutionDialog", () => ({
  TaskExecutionDialog: () => <button type="button">Upload Work Proof</button>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Project Process",
    description: "Additional project work",
    task_type: "additional_design",
    status: "in_progress",
    verification_status: "pending",
    priority: "Medium",
    deadline: "2026-07-30T00:00:00.000Z",
    assigned_to: "EMP-3D-1",
    assignee_ids: ["EMP-3D-1"],
    assigned_by: "LEAD-3D",
    department_id: "design",
    proof_required: false,
    proof_url: [],
    completion_percent: 0,
    created_at: "2026-07-16T00:00:00.000Z",
    updated_at: "2026-07-16T00:00:00.000Z",
    design_team: "3D",
    scope_type: "project",
    fixture_id: null,
    additional_task_kind: "Project Process",
    ...overrides,
  } as Task;
}

describe("TaskCard proof policy", () => {
  beforeEach(() => {
    executeTaskAction.mockReset();
    cancelTask.mockReset();
    toast.mockReset();
  });

  it("hides proof upload and allows an optional completion note for 3D project additional tasks", async () => {
    render(<TaskCard task={task()} />);

    expect(screen.queryByText("Upload Work Proof")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });
    expect(screen.getByText("Completion Note (optional)")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit Task" }));
    });
    expect(executeTaskAction).toHaveBeenCalledWith(1, "submit", "");
  });

  it("keeps proof upload and validation visible for proof-required workflow tasks", () => {
    render(<TaskCard task={task({
      task_type: "department_workflow",
      title: "3D Fixture Stage",
      additional_task_kind: undefined,
      design_team: undefined,
      scope_type: "fixture",
      fixture_id: "fixture-1",
      proof_required: true,
    })} />);

    expect(screen.getByText("Upload Work Proof")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Work proof required",
    }));
    expect(executeTaskAction).not.toHaveBeenCalled();
  });
});
