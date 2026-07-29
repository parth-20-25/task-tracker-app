import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ViewScope from "@/pages/ViewScope";

vi.mock("@/api/projectScopeApi", () => ({
  fetchProjectScope: () => Promise.resolve({
    working_hours_per_day: 8,
    projects: [{
      project_id: "p1", sr_no: 1, priority: null, project_no: "25-119", project_description: "Project",
      robotic_welding_fix: 4, manual_welding_fix: 0, spms: 1, manual_auto_inspection: 0, hand_gauge: 0,
      robotic_cell_shuttle: 0, servo_pumatic_gantry: 0, total_scope: 5, concept_hours: 8, dap_hours: null,
      three_d_finish_hours: 4, two_d_finish_hours: 4, total_hours: 16, days: 2, unclassified_fixture_count: 0,
    }],
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

describe("View Scope sheet", () => {
  it("renders the exact grouped planning columns without timeline requirements", async () => {
    render(<ViewScope />, { wrapper });
    expect(await screen.findByText("25-119")).toBeInTheDocument();
    for (const heading of ["SCOPE OF WORK", "WORK HRS REQUIRED", "ROBOTIC WELDING FIX", "SERVO / PUMATIC GANTRY", "TOTAL HOURS", "DAYS"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    expect(screen.queryByText(/Timeline Requirements/i)).toBeNull();
    expect(screen.queryByText(/Kick Off|CDRM|BOM Date/i)).toBeNull();
  });
});