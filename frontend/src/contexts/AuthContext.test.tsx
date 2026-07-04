import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/useAuth";
import { LoginRoute, ProtectedRoute } from "@/components/AuthRoutes";
import { setToken } from "@/api/http";
import type { User } from "@/types";

const authApiMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  loginRequest: vi.fn(),
}));

vi.mock("@/api/authApi", () => ({
  getCurrentUser: (...args: unknown[]) => authApiMocks.getCurrentUser(...args),
  loginRequest: (...args: unknown[]) => authApiMocks.loginRequest(...args),
}));

const testUser: User = {
  employee_id: "EMP001",
  name: "Test User",
  role_id: "operator",
  role: {
    id: "operator",
    name: "Operator",
    hierarchy_level: 1,
    permissions: { can_view_self_tasks: true },
    scope: "self",
  },
  permissions: ["can_view_self_tasks"],
  department_id: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

function AuthStatus() {
  const { logout, user } = useAuth();

  return (
    <div>
      <span>Signed in as {user?.employee_id}</span>
      <button type="button" onClick={logout}>Logout</button>
    </div>
  );
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderAuthRoutes(initialEntries: string[]) {
  const queryClient = createQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/" element={<ProtectedRoute><AuthStatus /></ProtectedRoute>} />
            <Route path="/tasks" element={<ProtectedRoute><div>Protected Tasks</div></ProtectedRoute>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function submitLogin(employeeId = "EMP001", password = "password") {
  fireEvent.change(screen.getByLabelText(/employee id/i), { target: { value: employeeId } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("AuthProvider login flow", () => {
  beforeEach(() => {
    setToken(null);
    window.localStorage.clear();
    authApiMocks.getCurrentUser.mockReset();
    authApiMocks.loginRequest.mockReset();
    authApiMocks.getCurrentUser.mockResolvedValue(testUser);
  });

  afterEach(() => {
    cleanup();
    setToken(null);
    window.localStorage.clear();
  });

  it("updates auth state immediately after successful login", async () => {
    authApiMocks.loginRequest.mockResolvedValue({ token: "token-123", user: testUser });

    renderAuthRoutes(["/login"]);
    submitLogin();

    await waitFor(() => expect(screen.getByText("Signed in as EMP001")).toBeInTheDocument());
    expect(authApiMocks.loginRequest).toHaveBeenCalledWith("EMP001", "password");
    expect(window.localStorage.getItem("token")).toBe("token-123");
  });

  it("allows a protected route immediately after login without refreshing", async () => {
    authApiMocks.loginRequest.mockResolvedValue({ token: "token-123", user: testUser });

    renderAuthRoutes(["/tasks"]);

    await screen.findByRole("button", { name: /sign in/i });
    submitLogin();

    await waitFor(() => expect(screen.getByText("Protected Tasks")).toBeInTheDocument());
    expect(window.localStorage.getItem("token")).toBe("token-123");
  });

  it("keeps the user on login and shows an error when login fails", async () => {
    authApiMocks.loginRequest.mockRejectedValue(new Error("Invalid password"));

    renderAuthRoutes(["/login"]);
    submitLogin("EMP001", "wrong-password");

    expect(await screen.findByText("Invalid password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
    expect(window.localStorage.getItem("token")).toBeNull();
  });

  it("clears auth state, token storage, and protected access on logout", async () => {
    setToken("existing-token");

    renderAuthRoutes(["/"]);

    await waitFor(() => expect(screen.getByText("Signed in as EMP001")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /logout/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument());
    expect(window.localStorage.getItem("token")).toBeNull();
  });
});
