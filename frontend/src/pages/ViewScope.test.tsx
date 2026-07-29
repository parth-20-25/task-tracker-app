import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/ApiError";
import { queryClient } from "@/lib/queryClient";
import ViewScope from "@/pages/ViewScope";

const { fetchProjectScope } = vi.hoisted(() => ({ fetchProjectScope: vi.fn() }));

vi.mock("@/api/projectScopeApi", () => ({
  fetchProjectScope,
}));

const scopeResponse = {
  working_hours_per_day: 8,
  projects: [{
    project_id: "p1", sr_no: 1, priority: null, project_no: "25-119", project_description: "Project",
    robotic_welding_fix: 4, manual_welding_fix: 0, spms: 1, manual_auto_inspection: 0, hand_gauge: 0,
    robotic_cell_shuttle: 0, servo_pumatic_gantry: 0, total_scope: 5, concept_hours: 8, dap_hours: null,
    three_d_finish_hours: 4, two_d_finish_hours: 4, total_hours: 16, days: 2, unclassified_fixture_count: 0,
  }],
};

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("View Scope sheet", () => {
  beforeEach(() => {
    queryClient.clear();
    fetchProjectScope.mockReset();
    fetchProjectScope.mockResolvedValue(scopeResponse);
  });

  it("renders the exact grouped planning columns without timeline requirements", async () => {
    render(<ViewScope />, { wrapper });
    expect(await screen.findByText("25-119")).toBeInTheDocument();
    for (const heading of ["SCOPE OF WORK", "WORK HRS REQUIRED", "ROBOTIC WELDING FIX", "SERVO / PUMATIC GANTRY", "TOTAL HOURS", "DAYS"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    expect(screen.queryByText(/Timeline Requirements/i)).toBeNull();
    expect(screen.queryByText(/Kick Off|CDRM|BOM Date/i)).toBeNull();
  });

  it.each([401, 403, 404])("does not retry a %i response", async (status) => {
    fetchProjectScope.mockRejectedValue(new ApiError("Request failed", status));
    render(<ViewScope />, { wrapper });

    expect(await screen.findByText("Request failed")).toBeInTheDocument();
    await waitFor(() => expect(fetchProjectScope).toHaveBeenCalledTimes(1));
  });
});
