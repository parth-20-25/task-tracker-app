import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/ApiError";
import { queryClient } from "@/lib/queryClient";
import ViewScope from "@/pages/ViewScope";

const { fetchProjectScope } = vi.hoisted(() => ({ fetchProjectScope: vi.fn() }));

vi.mock("@/api/projectScopeApi", () => ({
  fetchProjectScope,
}));

const project = {
  project_id: "p1", sr_no: 1, priority: null, project_no: "25-119-LONG-PROJECT-NUMBER", project_description: "Project Alpha long description",
  robotic_welding_fix: 4, manual_welding_fix: 0, spms: 1, manual_auto_inspection: 0, hand_gauge: 0,
  robotic_cell_shuttle: 0, servo_pumatic_gantry: 0, total_scope: 5, concept_hours: 8, dap_hours: null,
  three_d_finish_hours: 4, two_d_finish_hours: 4, total_hours: 16, days: 2, unclassified_fixture_count: 0,
};

const scopeResponse = {
  working_hours_per_day: 8,
  projects: [
    project,
    { ...project, project_id: "p2", sr_no: 2, project_no: "26-220", project_description: "Beta Welding Cell" },
    { ...project, project_id: "p3", sr_no: 3, project_no: "27-330", project_description: "Gamma Inspection Line" },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("Project Scope sheet", () => {
  beforeEach(() => {
    queryClient.clear();
    fetchProjectScope.mockReset();
    fetchProjectScope.mockResolvedValue(scopeResponse);
  });

  it("uses the Project Scope heading and document title", async () => {
    render(<ViewScope />, { wrapper });

    expect(await screen.findByRole("heading", { name: "Project Scope" })).toBeInTheDocument();
    expect(document.title).toBe("Project Scope");
    expect(screen.queryByText("View Scope")).not.toBeInTheDocument();
  });

  it("renders API data, grouped planning columns, and missing planned time", async () => {
    render(<ViewScope />, { wrapper });
    expect(await screen.findByText("25-119-LONG-PROJECT-NUMBER")).toBeInTheDocument();
    for (const heading of ["PROJECT DETAILS", "SCOPE OF WORK", "WORK HRS REQUIRED", "TOTALS", "ROBOTIC WELDING FIX", "SERVO / PUMATIC GANTRY", "TOTAL HOURS", "DAYS"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText(/Timeline Requirements/i)).toBeNull();
    expect(screen.queryByText(/Kick Off|CDRM|BOM Date/i)).toBeNull();
  });

  it("filters by project number and description, clears, and reports counts", async () => {
    render(<ViewScope />, { wrapper });
    const input = await screen.findByPlaceholderText("Search by project number or project name");

    expect(await screen.findByText("3 active projects")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "  26-220  " } });
    expect(screen.getByText("Beta Welding Cell")).toBeInTheDocument();
    expect(screen.queryByText("Project Alpha long description")).toBeNull();
    expect(screen.getByText("1 of 3 active projects")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "PROJECT ALPHA" } });
    expect(screen.getByText("Project Alpha long description")).toBeInTheDocument();
    expect(screen.queryByText("Beta Welding Cell")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear project search" }));
    expect(screen.getByText("Project Alpha long description")).toBeInTheDocument();
    expect(screen.getByText("Beta Welding Cell")).toBeInTheDocument();
    expect(screen.getByText("Gamma Inspection Line")).toBeInTheDocument();
    expect(await screen.findByText("3 active projects")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "missing project" } });
    expect(screen.getByText("0 projects found")).toBeInTheDocument();
    expect(screen.getByText("0 of 3 active projects")).toBeInTheDocument();
    expect(fetchProjectScope).toHaveBeenCalledTimes(1);
  });

  it("uses fixed columns, sticky offsets, and protected project text", async () => {
    const { container } = render(<ViewScope />, { wrapper });
    const projectNumber = await screen.findByText("25-119-LONG-PROJECT-NUMBER");
    const projectDescription = screen.getByText("Project Alpha long description");
    const projectNumberCell = projectNumber.closest("td");
    const projectDescriptionCell = projectDescription.closest("td");

    expect(container.querySelector("table")).toHaveStyle({ width: "2377px", minWidth: "2377px" });
    expect(container.querySelectorAll("col")).toHaveLength(18);
    expect(screen.getByRole("columnheader", { name: "PROJECT NO." })).toHaveStyle({ left: "152px", width: "160px" });
    expect(screen.getByRole("columnheader", { name: "PROJECT DESCRIPTION" })).toHaveStyle({ left: "312px", width: "320px" });
    expect(projectNumberCell).toHaveClass("sticky", "overflow-hidden", "whitespace-nowrap", "bg-white");
    expect(projectNumberCell).toHaveAttribute("title", "25-119-LONG-PROJECT-NUMBER");
    expect(projectDescriptionCell).toHaveClass("sticky", "overflow-hidden", "whitespace-nowrap", "bg-white");
    expect(projectDescriptionCell).toHaveAttribute("title", "Project Alpha long description");
    expect(projectNumber).toHaveClass("text-ellipsis");
    expect(projectDescription).toHaveClass("text-ellipsis");
  });

  it.each([401, 403, 404])("does not retry a %i response", async (status) => {
    fetchProjectScope.mockRejectedValue(new ApiError("Request failed", status));
    render(<ViewScope />, { wrapper });

    expect(await screen.findByText("Request failed")).toBeInTheDocument();
    await waitFor(() => expect(fetchProjectScope).toHaveBeenCalledTimes(1));
  });
});
