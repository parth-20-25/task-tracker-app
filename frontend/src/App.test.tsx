import { Suspense, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppLayoutRoutes } from "@/App";

vi.mock("@/components/PWAUpdatePrompt", () => ({ PWAUpdatePrompt: () => null }));

vi.mock("@/contexts/useAuth", () => ({
  useAuth: () => ({
    access: {
      canAccessAdminPanel: false,
      canViewAnalytics: false,
      canViewProjectScope: true,
      canViewReports: false,
      canViewTeamActivity: false,
      canViewTeamTasks: false,
    },
    user: null,
  }),
}));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/pages/ViewScope", () => ({ default: () => <h1>Project Scope route page</h1> }));

describe("Project Scope route compatibility", () => {
  it("opens the existing /view-scope route", async () => {
    render(
      <MemoryRouter initialEntries={["/view-scope"]}>
        <Suspense><AppLayoutRoutes /></Suspense>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Project Scope route page" })).toBeInTheDocument();
  });
});
