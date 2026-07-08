import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OverdueAlertModal } from "@/components/OverdueAlertModal";
import type { OverdueAlert } from "@/types";

const fetchMyOverdueAlerts = vi.fn();
const fetchTeamOverdueAlerts = vi.fn();
const acknowledgeNotification = vi.fn();

vi.mock("@/api/notificationApi", () => ({
  fetchMyOverdueAlerts: (...args: unknown[]) => fetchMyOverdueAlerts(...args),
  fetchTeamOverdueAlerts: (...args: unknown[]) => fetchTeamOverdueAlerts(...args),
  acknowledgeNotification: (...args: unknown[]) => acknowledgeNotification(...args),
}));

function alert(overrides: Partial<OverdueAlert> = {}): OverdueAlert {
  return {
    notification_id: "notification-1",
    notification_type: "OVERDUE_TASK",
    notification_status: "unread",
    notification_title: "Overdue Task Alert",
    notification_message: "Concept is overdue.",
    severity: "warning",
    triggered_at: "2026-07-08T10:00:00.000Z",
    task_id: 10,
    project_id: "project-1",
    project_number: "PARC-001",
    project_name: "Fixture Build",
    stage_task_name: "Concept",
    deadline: "2026-07-08T08:00:00.000Z",
    overdue_minutes: 125,
    time_overdue: "2h 5m overdue",
    current_status: "in_progress",
    employee_name: null,
    employee_id: null,
    ...overrides,
  };
}

function renderModal(includeTeam = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OverdueAlertModal includeTeam={includeTeam} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OverdueAlertModal", () => {
  beforeEach(() => {
    fetchMyOverdueAlerts.mockResolvedValue([]);
    fetchTeamOverdueAlerts.mockResolvedValue([]);
    acknowledgeNotification.mockResolvedValue({ id: "notification-1", status: "acknowledged" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("appears when overdue tasks exist", async () => {
    fetchMyOverdueAlerts.mockResolvedValue([alert()]);

    renderModal(false);

    expect(await screen.findByRole("heading", { name: "Overdue Alerts" })).toBeInTheDocument();
    expect(screen.getByText("My Overdue Tasks")).toBeInTheDocument();
    expect(screen.getByText("PARC-001")).toBeInTheDocument();
    expect(screen.getByText("Fixture Build")).toBeInTheDocument();
    expect(screen.getByText("Concept")).toBeInTheDocument();
    expect(screen.getByText("2h 5m overdue")).toBeInTheDocument();
  });

  it("does not appear when no overdue tasks exist", async () => {
    renderModal(false);

    await waitFor(() => expect(fetchMyOverdueAlerts).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading", { name: "Overdue Alerts" })).not.toBeInTheDocument();
  });

  it("acknowledge button calls the notification API", async () => {
    fetchMyOverdueAlerts.mockResolvedValue([alert({ notification_id: "notification-ack" })]);

    renderModal(false);

    fireEvent.click(await screen.findByRole("button", { name: /Acknowledge/i }));

    await waitFor(() => expect(acknowledgeNotification).toHaveBeenCalled());
    expect(acknowledgeNotification.mock.calls[0][0]).toBe("notification-ack");
  });

  it("leader view displays employee, project, and task details", async () => {
    fetchTeamOverdueAlerts.mockResolvedValue([
      alert({
        notification_id: "team-notification-1",
        notification_type: "TEAM_OVERDUE_TASK",
        notification_title: "Team Overdue Alert",
        employee_name: "Ravi Kumar",
        employee_id: "EMP-22",
        project_number: "PARC-TEAM-9",
        project_name: "Team Fixture",
        stage_task_name: "2D Finish",
        current_status: "assigned",
      }),
    ]);

    renderModal(true);

    expect(await screen.findByText("Team Overdue Alert")).toBeInTheDocument();
    expect(screen.getByText("Ravi Kumar (EMP-22)")).toBeInTheDocument();
    expect(screen.getByText("PARC-TEAM-9")).toBeInTheDocument();
    expect(screen.getByText("Team Fixture")).toBeInTheDocument();
    expect(screen.getByText("2D Finish")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Details/i })).toBeInTheDocument();
  });
});