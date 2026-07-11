import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutiveDashboard } from "@/components/ExecutiveDashboard";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ExecutiveDashboardResponse } from "@/api/executiveDashboardApi";

const fetchExecutiveDashboard = vi.fn();

vi.mock("@/api/executiveDashboardApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/executiveDashboardApi")>();
  return {
    ...actual,
    fetchExecutiveDashboard: (...args: unknown[]) => fetchExecutiveDashboard(...args),
  };
});

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => ({
    user: {
      employee_id: "ADMIN-1",
      department_id: null,
      role: { id: "admin", name: "Admin", permissions: {}, hierarchy_level: 1 },
      permissions: [],
    },
    access: { canViewAllDepartmentsAnalytics: true },
  }),
}));

function emptyResponse(department: "design" | "control" | "all" = "design"): ExecutiveDashboardResponse {
  const departmentLabel = department === "all" ? "All Departments" : department === "design" ? "Design Department" : "Control Department";
  return {
    timezone: "Asia/Kolkata",
    selected_department: {
      id: department === "all" ? null : department,
      label: departmentLabel,
      mode: department === "all" ? "all" : "department",
    },
    filters: {
      department,
      period: "this_week",
      period_label: "This Week",
      status: "all",
      risk: "all",
      search: "",
      start: "2026-07-05T18:30:00.000Z",
      end: "2026-07-12T18:30:00.000Z",
    },
    departments: [
      { id: "design", label: "Design Department", name: "Design Department" },
      { id: "control", label: "Control Department", name: "Control Department" },
    ],
    kpis: [
      { id: "total_active_projects", label: "Total Active Projects", value: 0, detail: "None", tooltip: "Active projects", tone: "blue" },
      { id: "completed_this_period", label: "Projects Completed This Week", value: 0, detail: "None", tooltip: "Completed projects", tone: "green" },
      { id: "on_track", label: "On Track", value: 0, detail: "0%", tooltip: "On track", tone: "green" },
      { id: "at_risk", label: "At Risk", value: 0, detail: "0%", tooltip: "At risk", tone: "amber" },
      { id: "pending_approval", label: "Pending Approval", value: 0, detail: "0 over 24h", tooltip: "Pending approvals", tone: "blue" },
      { id: "overdue", label: "Overdue", value: 0, detail: "0%", tooltip: "Overdue projects", tone: "red" },
    ],
    needs_attention: [],
    overview: {
      title: `${departmentLabel} Overview (This Week)`,
      total_projects: 0,
      comparison: { direction: "neutral", text: "No change vs last week" },
      segments: [
        { id: "completed", label: "Completed", value: 0, percent: 0, tone: "green" },
        { id: "active", label: "Active", value: 0, percent: 0, tone: "blue" },
        { id: "delayed", label: "Delayed", value: 0, percent: 0, tone: "red" },
        { id: "not_started", label: "Not Started", value: 0, percent: 0, tone: "neutral" },
      ],
    },
    department_comparison: [],
    owner_workload: { title: "Owner Workload", basis: "Relative active project count within the selected scope", items: [] },
    approvals_summary: { pending_my_approval: 0, pending_over_24h: 0, pending_over_48h: 0 },
    table: { rows: [], page: 1, page_size: 7, total_rows: 0, total_pages: 0 },
  };
}

function renderDashboard(route = "/?department=design&period=this_week&status=all&risk=all&page=1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[route]}>
          <ExecutiveDashboard />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("ExecutiveDashboard", () => {
  beforeEach(() => {
    fetchExecutiveDashboard.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("uses one canonical filter state for the request and subtitle", async () => {
    fetchExecutiveDashboard.mockResolvedValue(emptyResponse("design"));

    renderDashboard();

    await waitFor(() => expect(fetchExecutiveDashboard).toHaveBeenCalledTimes(1));
    expect(fetchExecutiveDashboard.mock.calls[0][0]).toMatchObject({
      department: "design",
      period: "this_week",
      status: "all",
      risk: "all",
      page: 1,
      page_size: 7,
    });
    expect(await screen.findByText("Design Department • This Week")).toBeInTheDocument();
  });

  it("does not retry failed requests and retry triggers one new request", async () => {
    fetchExecutiveDashboard
      .mockRejectedValueOnce(new Error("database failed"))
      .mockResolvedValueOnce(emptyResponse("design"));

    renderDashboard();

    expect(await screen.findByText("Dashboard unavailable")).toBeInTheDocument();
    await waitFor(() => expect(fetchExecutiveDashboard).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Total Active Projects")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(fetchExecutiveDashboard).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Total Active Projects")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard unavailable")).not.toBeInTheDocument();
  });
});
