import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReleaseDeliverablesPanel } from "@/components/ReleaseDeliverablesPanel";

const fetchFixtureReleasePackage = vi.fn();

vi.mock("@/api/releaseDeliverablesApi", () => ({
  assignFixtureReleaseDeliverable: vi.fn(),
  fetchFixtureReleasePackage: (...args: unknown[]) => fetchFixtureReleasePackage(...args),
  reviewFixtureReleaseDeliverable: vi.fn(),
  setMimicReleaseDeliverableApplicability: vi.fn(),
  startFixtureReleaseDeliverable: vi.fn(),
  submitFixtureReleaseDeliverable: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const response = {
  release_package: {
    id: "package-1",
    fixture_id: "fixture-1",
    version: 1,
    status: "IN_PROGRESS",
    created_at: "2026-07-13T00:00:00.000Z",
    completed_at: null,
    deliverables: [
      {
        id: "deliverable-1",
        package_id: "package-1",
        deliverable_code: "DRAFTING",
        deliverable_label: "Drafting",
        sequence: 1,
        is_required: true,
        applicability_status: "REQUIRED",
        status: "READY",
        assignee_id: "DES-1",
        assignee_name: "Designer One",
        due_at: "2026-07-12T00:00:00.000Z",
        is_overdue: true,
        latest_comment: "Start with the approved concept.",
        is_current_actionable: true,
        available_actions: ["START"],
        events: [
          {
            id: "event-1",
            event_type: "ASSIGNED",
            actor_id: "LEAD-1",
            actor_name: "Design Lead",
            reason: null,
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
      },
    ],
  },
  statuses: {
    main_workflow: { code: "COMPLETED", label: "Completed" },
    release_deliverables: { code: "IN_PROGRESS", label: "0/1 approved", approved: 0, total: 1 },
    release: { code: "BLOCKED", label: "Blocked by deliverables" },
  },
  blockers: [{ code: "DELIVERABLES_INCOMPLETE", message: "Drafting is not approved" }],
  available_actions: [],
};

function renderPanel(readOnly = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <section data-testid="main-workflow">Existing main workflow</section>
      <ReleaseDeliverablesPanel
        fixtureId="fixture-1"
        departmentId="design"
        assignableUsers={[{ employee_id: "DES-1", name: "Designer One" }]}
        readOnly={readOnly}
      />
    </QueryClientProvider>,
  );
}

describe("ReleaseDeliverablesPanel", () => {
  beforeEach(() => {
    fetchFixtureReleasePackage.mockResolvedValue(response);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders release deliverables separately and emphasizes the current actionable item", async () => {
    renderPanel();

    const panel = screen.getByTestId("release-deliverables-panel");
    expect(screen.getByTestId("main-workflow")).not.toContainElement(panel);
    expect(within(panel).getByText("2D Release Deliverables")).toBeInTheDocument();
    await within(panel).findByText("Current actionable");
    expect(within(panel).getByText("Current actionable")).toBeInTheDocument();
    expect(within(panel).getByText("Designer One")).toBeInTheDocument();
    expect(within(panel).getByText("Overdue")).toBeInTheDocument();
    expect(within(panel).getByText("Start with the approved concept.")).toBeInTheDocument();
  });

  it("shows release state and exact blockers supplied by the backend", async () => {
    renderPanel();

    const panel = screen.getByTestId("release-deliverables-panel");
    await within(panel).findByText("Blocked by deliverables");
    expect(within(panel).getByText("Blocked by deliverables")).toBeInTheDocument();
    expect(within(panel).getByText("Drafting is not approved")).toBeInTheDocument();
    expect(within(panel).getAllByText("0/1 approved")).toHaveLength(2);
  });

  it("hides backend-disallowed actions in read-only mode", async () => {
    renderPanel(true);

    const panel = screen.getByTestId("release-deliverables-panel");
    await within(panel).findByText("No action");
    expect(within(panel).getByText("No action")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });
  it("hides actions that the backend permission response does not allow", async () => {
    fetchFixtureReleasePackage.mockResolvedValueOnce({
      ...response,
      release_package: {
        ...response.release_package,
        deliverables: response.release_package.deliverables.map((deliverable) => ({
          ...deliverable,
          available_actions: [],
        })),
      },
    });
    renderPanel();

    const panel = screen.getByTestId("release-deliverables-panel");
    await within(panel).findByText("No action");
    expect(within(panel).queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });
});
