import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/useAuth";
import { getPostLoginRedirectPath } from "@/lib/authNavigation";
import { AppBootSkeleton } from "@/components/LoadingSkeletons";
import Login from "@/pages/Login";

export function LoginRoute() {
  const { isAuthenticated, isReady } = useAuth();
  const location = useLocation();

  if (!isReady) {
    return <AppBootSkeleton />;
  }

  if (isAuthenticated) {
    return <Navigate to={getPostLoginRedirectPath(location.state)} replace />;
  }

  return <Login />;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isReady } = useAuth();
  const location = useLocation();

  if (!isReady) {
    return <AppBootSkeleton />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
