import React, { useCallback, useEffect, useState } from "react";
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
  const [sessionToken, setSessionToken] = useState(() => getStoredToken());
  const hasToken = Boolean(sessionToken);
  const currentUserQuery = useCurrentUserQuery(hasToken);
  const currentUser = currentUserQuery.data ?? null;

  const role = currentUser?.role || null;
  const access = buildUiAccess(currentUser);

  const persistSessionToken = useCallback((token: string | null) => {
    setToken(token);
    setSessionToken(token);
  }, []);

  useEffect(() => {
    if (!hasToken || !currentUserQuery.isError) {
      return;
    }

    if (currentUserQuery.error instanceof ApiError && currentUserQuery.error.status === 401) {
      persistSessionToken(null);
      queryClient.removeQueries({ queryKey: authQueryKeys.currentUser });
    }
  }, [currentUserQuery.error, currentUserQuery.isError, hasToken, persistSessionToken, queryClient]);

  const refreshSession = useCallback(async () => {
    if (!getStoredToken()) {
      persistSessionToken(null);
      queryClient.removeQueries({ queryKey: authQueryKeys.currentUser });
      return;
    }

    const result = await currentUserQuery.refetch();

    if (result.error) {
      persistSessionToken(null);
      queryClient.removeQueries({ queryKey: authQueryKeys.currentUser });
    }
  }, [currentUserQuery, persistSessionToken, queryClient]);

  const login = useCallback(async (employeeId: string, password: string): ReturnType<AuthContextType["login"]> => {
    try {
      const response = await loginRequest(employeeId, password);
      persistSessionToken(response.token);
      queryClient.setQueryData(authQueryKeys.currentUser, response.user);
      void queryClient.invalidateQueries({ queryKey: authQueryKeys.currentUser });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Login failed",
      };
    }
  }, [persistSessionToken, queryClient]);

  const logout = useCallback(() => {
    persistSessionToken(null);
    void queryClient.cancelQueries();
    queryClient.setQueryData(authQueryKeys.currentUser, null);
    queryClient.removeQueries();
  }, [persistSessionToken, queryClient]);

  const hasPermission = useCallback((permission: string) => {
    return hasUserPermission(currentUser, permission);
  }, [currentUser]);

  const hasResolvedCurrentUser = currentUserQuery.data !== undefined || currentUserQuery.isFetched || currentUserQuery.isError;

  return (
    <AuthContext.Provider
      value={{
        user: currentUser,
        role,
        access,
        login,
        logout,
        isAuthenticated: hasToken && !!currentUser,
        isReady: !hasToken || hasResolvedCurrentUser,
        hasPermission,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
