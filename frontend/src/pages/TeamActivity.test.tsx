import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TeamActivity from "@/pages/TeamActivity";

const { fetchTeamActivity } = vi.hoisted(() => ({ fetchTeamActivity: vi.fn() }));
vi.mock("@/api/teamActivityApi", () => ({ fetchTeamActivity }));
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>; }

describe("Team Activity", () => {
  beforeEach(() => {
    queryClient.clear();
    fetchTeamActivity.mockReset();
    fetchTeamActivity.mockResolvedValue([
      { employee_id: "EMP-1", employee_name: "Rahul Patil", current_task: "25-119 · F01\nDrafting", total_active_tasks: 4, status: "Working", tasks: [{ task_id: "1", project_no: "25-119", task_or_fixture: "F01", stage: "Drafting", status: "in_progress", assignee: "Rahul Patil", proof_urls: ["/proof.png"] }] },
      { employee_id: "EMP-2", employee_name: "Neha More", current_task: "No assigned tasks", total_active_tasks: 0, status: "Available", tasks: [] },
    ]);
  });

  it("renders the compact activity columns and requests once on initial render", async () => {
    render(<TeamActivity />, { wrapper });
    expect(await screen.findByText("Rahul Patil")).toBeInTheDocument();
    for (const heading of ["Employee Name", "Current Task", "Total Active Tasks", "Status"]) expect(screen.getByRole("columnheader", { name: heading })).toBeInTheDocument();
    expect(screen.queryByText(/start time/i)).toBeNull();
    await waitFor(() => expect(fetchTeamActivity).toHaveBeenCalledTimes(1));
  });

  it("expands an employee into scoped task details and a proof link", async () => {
    render(<TeamActivity />, { wrapper });
    fireEvent.click(await screen.findByText("Rahul Patil"));
    expect(screen.getByText("Task/Fixture")).toBeInTheDocument();
    expect(screen.getByText("F01")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View proof for F01" })).toHaveAttribute("href", "/proof.png");
  });

  it("filters by employee and status without another request", async () => {
    render(<TeamActivity />, { wrapper });
    expect(await screen.findByText("Rahul Patil")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Employee search"), { target: { value: "Neha" } });
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "Available" } });
    expect(screen.getByText("Neha More")).toBeInTheDocument();
    expect(screen.queryByText("Rahul Patil")).toBeNull();
    expect(fetchTeamActivity).toHaveBeenCalledTimes(1);
  });
});