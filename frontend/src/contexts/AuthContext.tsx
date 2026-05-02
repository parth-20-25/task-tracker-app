import React, { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loginRequest } from "@/api/authApi";
import { getStoredToken, setToken } from "@/api/http";
import { useCurrentUserQuery } from "@/hooks/queries/useCurrentUserQuery";
import { authQueryKeys } from "@/lib/queryKeys";
import { ApiError } from "@/lib/api/ApiError";
import { buildUiAccess, hasUserPermission } from "@/lib/permissions";
import { AuthContext, type AuthContextType } from "@/contexts/useAuth";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const currentUserQuery = useCurrentUserQuery();
  const currentUser = currentUserQuery.data ?? null;
  const hasToken = !!getStoredToken();

  const role = currentUser?.role || null;
  const access = buildUiAccess(currentUser);

  useEffect(() => {
    if (!hasToken || !currentUserQuery.isError) {
      return;
    }

    if (currentUserQuery.error instanceof ApiError && currentUserQuery.error.status === 401) {
      setToken(null);
      queryClient.removeQueries({ queryKey: authQueryKeys.currentUser });
    }
  }, [currentUserQuery.error, currentUserQuery.isError, hasToken, queryClient]);

  const refreshSession = useCallback(async () => {
    if (!getStoredToken()) {
      queryClient.removeQueries({ queryKey: authQueryKeys.currentUser });
      return;
    }

    try {
      await currentUserQuery.refetch();
    } catch (_error) {
      setToken(null);
      queryClient.removeQueries({ queryKey: authQueryKeys.currentUser });
    }
  }, [currentUserQuery, queryClient]);

  const login = useCallback(async (employeeId: string, password: string): ReturnType<AuthContextType["login"]> => {
    try {
      const response = await loginRequest(employeeId, password);
      setToken(response.token);
      queryClient.setQueryData(authQueryKeys.currentUser, response.user);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Login failed",
      };
    }
  }, [queryClient]);

  const logout = useCallback(() => {
    setToken(null);
    queryClient.setQueryData(authQueryKeys.currentUser, null);
    void queryClient.cancelQueries();
    queryClient.removeQueries();
  }, [queryClient]);

  const hasPermission = useCallback((permission: string) => {
    return hasUserPermission(currentUser, permission);
  }, [currentUser]);

  return (
    <AuthContext.Provider
      value={{
        user: currentUser,
        role,
        access,
        login,
        logout,
        isAuthenticated: !!currentUser,
        isReady: !hasToken || currentUserQuery.isFetched || currentUserQuery.isError,
        hasPermission,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
