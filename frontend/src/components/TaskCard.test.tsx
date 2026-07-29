import { act, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCard } from "@/components/TaskCard";
import type { Task } from "@/types";

const executeTaskAction = vi.fn();
const cancelTask = vi.fn();
const toast = vi.fn();

const auth = vi.hoisted(() => ({
  user: { employee_id: "EMP-3D-1", id: "user-3d-1", is_active: true },
  access: { canAssignTasks: false, canEditTasks: false, canDeleteTasks: false },
}));

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => auth,
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
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
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
    auth.user = { employee_id: "EMP-3D-1", id: "user-3d-1", is_active: true };
    auth.access = { canAssignTasks: false, canEditTasks: false, canDeleteTasks: false };
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
  it("shows DAP Upload Work Proof while allowing submission without a file", async () => {
    executeTaskAction.mockResolvedValue(undefined);
    render(<TaskCard task={task({
      task_type: "department_workflow",
      title: "DAP",
      workflow_stage: "DAP",
      additional_task_kind: undefined,
      design_team: undefined,
      scope_type: "fixture",
      fixture_id: "fixture-1",
      proof_required: true,
      proof_url: [],
    })} />);

    expect(screen.getByText("Upload Work Proof")).toBeTruthy();
    expect(screen.queryByText(/optional/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(executeTaskAction).toHaveBeenCalledWith(1, "submit", undefined));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Work proof required" }));
  });
  it("shows cancel for the original assigner even when task actions are hidden", async () => {
    auth.user = { employee_id: "LEAD-3D", id: "lead-3d", is_active: true };
    cancelTask.mockResolvedValue(undefined);

    render(<TaskCard task={task({
      status: "in_progress",
      assigned_to: "EMP-3D-1",
      assigned_by: "LEAD-3D",
      assignee_names: "EMP-3D-1 - Designer One",
      project_name: "Press Line",
      fixture_no: "FX-1",
    })} showActions={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel Task" }));

    expect(screen.getByText("Are you sure you want to cancel this task? The assignment will be removed, but the task history will remain available.")).toBeTruthy();
    expect(screen.getAllByText("Project Process").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Press Line").length).toBeGreaterThan(0);
    expect(screen.getAllByText("FX-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EMP-3D-1 - Designer One").length).toBeGreaterThan(0);

    const cancelButtons = screen.getAllByRole("button", { name: "Cancel Task" });
    const confirmButton = cancelButtons[cancelButtons.length - 1];
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Cancellation reason"), { target: { value: "Assigned by mistake" } });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(cancelTask).toHaveBeenCalledWith(1, "Assigned by mistake"));
  });
});
