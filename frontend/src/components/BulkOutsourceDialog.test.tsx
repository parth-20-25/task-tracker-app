import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BulkOutsourceDialog } from "@/components/BulkOutsourceDialog";

const bulkOutsourceFixtures = vi.fn();
const fetchDesignVendors = vi.fn();
const previewBulkFixtureOutsource = vi.fn();

vi.mock("@/api/outsourceAssignmentsApi", () => ({
  bulkOutsourceFixtures: (...args: unknown[]) => bulkOutsourceFixtures(...args),
  fetchDesignVendors: (...args: unknown[]) => fetchDesignVendors(...args),
  previewBulkFixtureOutsource: (...args: unknown[]) => previewBulkFixtureOutsource(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled }: { children: ReactNode; value: string; onValueChange?: (value: string) => void; disabled?: boolean }) => (
    <input role="combobox" value={value} disabled={disabled} onChange={(event) => onValueChange?.(event.target.value)} />
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: () => null,
}));

const vendor = { id: "vendor-1", name: "External Tooling Ltd", code: "EXT", is_active: true };
const coordinator = { employee_id: "COORD-1", name: "Internal Coordinator" };

function renderDialog(scope: "all_assignable" | "selected", fixtureIds: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BulkOutsourceDialog
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        projectLabel="P-001 — Project One"
        workflowStage="DAP"
        scope={scope}
        fixtureIds={fixtureIds}
        requestedCount={scope === "selected" ? fixtureIds.length : 3}
        coordinators={[coordinator]}
        onCompleted={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

async function completeRequiredFields() {
  await waitFor(() => expect(fetchDesignVendors).toHaveBeenCalled());
  const vendorSelect = screen.getByText("External vendor *").parentElement?.querySelector('[role="combobox"]');
  if (!vendorSelect) throw new Error("Vendor select not found");
  fireEvent.change(vendorSelect, { target: { value: vendor.id } });
  await waitFor(() => expect(screen.getByText("External vendor *").parentElement?.querySelector('[role="combobox"]')).toHaveValue(vendor.id));
  const coordinatorSelect = screen.getByText("Internal coordinator *").parentElement?.querySelector('[role="combobox"]');
  if (!coordinatorSelect) throw new Error("Coordinator select not found");
  fireEvent.change(coordinatorSelect, { target: { value: coordinator.employee_id } });
  await waitFor(() => expect(screen.getByText("Internal coordinator *").parentElement?.querySelector('[role="combobox"]')).toHaveValue(coordinator.employee_id));
  const deadline = document.querySelector<HTMLInputElement>('input[type="date"]');
  if (!deadline) throw new Error("Deadline input not found");
  fireEvent.change(deadline, { target: { value: "2026-07-31" } });
  const instructionsLabel = screen.getByText("Instructions *");
  const instructions = instructionsLabel.parentElement?.querySelector("textarea");
  if (!instructions) throw new Error("Instructions field not found");
  fireEvent.change(instructions, { target: { value: "Complete DAP and return drawings." } });
  expect(deadline).toHaveValue("2026-07-31");
  expect(instructions).toHaveValue("Complete DAP and return drawings.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Review Eligibility" })).toBeEnabled());
}

describe("BulkOutsourceDialog", () => {
  beforeEach(() => {
    fetchDesignVendors.mockResolvedValue([vendor]);
    previewBulkFixtureOutsource.mockImplementation(async (payload) => ({
      project: { project_id: "project-1", project_code: "P-001", project_name: "Project One" },
      workflow_stage: payload.workflow_stage,
      workflow_stage_code: "dap",
      scope: payload.scope,
      requested: payload.scope === "selected" ? payload.fixture_ids.length : 3,
      eligible: payload.scope === "selected" ? payload.fixture_ids.length : 2,
      eligible_fixture_ids: payload.scope === "selected" ? payload.fixture_ids : ["fixture-1", "fixture-2"],
      skipped: payload.scope === "selected" ? [] : [{
        fixture_id: "fixture-3",
        fixture_no: "F03",
        code: "ALREADY_ASSIGNED_INTERNAL",
        message: "Fixture is already assigned internally",
      }],
    }));
    bulkOutsourceFixtures.mockResolvedValue({
      requested: 3,
      outsourced: 2,
      assignments: [],
      skipped: [{
        fixture_id: "fixture-3",
        fixture_no: "F03",
        code: "ALREADY_ASSIGNED_INTERNAL",
        message: "Fixture is already assigned internally",
      }],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("sends all-assignable scope and the selected workflow, then displays partial success", async () => {
    renderDialog("all_assignable", ["fixture-ignored"]);
    await completeRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "Review Eligibility" }));
    await waitFor(() => expect(previewBulkFixtureOutsource).toHaveBeenCalledWith(expect.objectContaining({
      project_id: "project-1",
      workflow_stage: "DAP",
      scope: "all_assignable",
      fixture_ids: [],
      vendor_id: "vendor-1",
      internal_coordinator_id: "COORD-1",
    })));
    expect(await screen.findByTestId("bulk-outsource-review")).toHaveTextContent("Fixture is already assigned internally");

    fireEvent.click(screen.getByRole("button", { name: "Confirm Outsource (2)" }));
    await waitFor(() => expect(bulkOutsourceFixtures).toHaveBeenCalledWith(expect.objectContaining({
      workflow_stage: "DAP",
      scope: "all_assignable",
      fixture_ids: [],
    })));
    expect(await screen.findByTestId("bulk-outsource-result")).toHaveTextContent("Successfully outsourced");
    expect(screen.getByTestId("bulk-outsource-result")).toHaveTextContent("ALREADY_ASSIGNED_INTERNAL");
    expect(screen.getByTestId("bulk-outsource-result")).toHaveTextContent("Fixture is already assigned internally");
  });

  it("sends only selected fixture ids and keeps vendor identity separate from employees", async () => {
    renderDialog("selected", ["fixture-1", "fixture-2"]);
    expect(screen.getByText("External vendor *")).toBeInTheDocument();
    expect(screen.getByText("Internal coordinator *")).toBeInTheDocument();
    expect(screen.queryByText("Employee")).not.toBeInTheDocument();
    await completeRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "Review Eligibility" }));
    await waitFor(() => expect(previewBulkFixtureOutsource).toHaveBeenCalledWith(expect.objectContaining({
      workflow_stage: "DAP",
      scope: "selected",
      fixture_ids: ["fixture-1", "fixture-2"],
    })));
  });
});
