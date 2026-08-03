import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/useAuth";
import { TaskProvider } from "@/contexts/TaskContext";
import { LoginRoute, ProtectedRoute } from "@/components/AuthRoutes";
import { AppLayout } from "@/components/AppLayout";
import { RouteContentSkeleton } from "@/components/LoadingSkeletons";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import React, { Suspense } from "react";
import { isDesignDepartment } from "@/lib/departments";
import { hasMappedTeamMembers, isProjectAuthorityUser } from "@/lib/permissions";
import { getProtocolTargetPath } from "@/lib/protocolNavigation";
import { queryClient } from "@/lib/queryClient";

const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const MyTasks = React.lazy(() => import("./pages/MyTasks"));
const TaskDetail = React.lazy(() => import("./pages/TaskDetail"));
const TeamTasks = React.lazy(() => import("./pages/TeamTasks"));
const AdminPanel = React.lazy(() => import("./pages/AdminPanel"));
const Analytics = React.lazy(() => import("./pages/Analytics/AnalyticsDashboard"));
const Reports = React.lazy(() => import("./pages/Reports"));
const DesignReportViewPage = React.lazy(() => import("./pages/DesignReportViewPage"));
const Batches = React.lazy(() => import("./pages/Batches"));
const AdditionalDesignTasks = React.lazy(() => import("./pages/AdditionalDesignTasks"));
const ViewScope = React.lazy(() => import("./pages/ViewScope"));
const TeamActivity = React.lazy(() => import("./pages/TeamActivity"));
const NotFound = React.lazy(() => import("./pages/NotFound"));


export function AppLayoutRoutes() {
  const { access, user } = useAuth();
  const canAccessAdditionalDesignTasks = isDesignDepartment(user) || isProjectAuthorityUser(user);
  const canViewTeamActivity = access.canViewTeamActivity && hasMappedTeamMembers(user);

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<MyTasks />} />
        <Route path="/tasks/:taskId" element={<TaskDetail />} />
        <Route path="/batches" element={<Batches />} />
        {access.canViewProjectScope && <Route path="/view-scope" element={<ViewScope />} />}
        {canAccessAdditionalDesignTasks && <Route path="/additional-design-tasks" element={<AdditionalDesignTasks />} />}
        {access.canViewTeamTasks && <Route path="/team-tasks" element={<TeamTasks />} />}
        {canViewTeamActivity && <Route path="/team-activity" element={<TeamActivity />} />}
        {access.canViewAnalytics && <Route path="/analytics/*" element={<Analytics />} />}
        {access.canViewReports && <Route path="/reports" element={<Reports />} />}
        {access.canAccessAdminPanel && ["/admin", "/admin/users", "/admin/roles", "/admin/departments", "/admin/workflows", "/admin/audit"].map((path) => (
          <Route key={path} path={path} element={<AdminPanel />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

function AuthenticatedApp() {
  const { access } = useAuth();

  return (
    <TaskProvider>
      <Suspense fallback={<RouteContentSkeleton />}>
        <Routes>
          {access.canViewReports && <Route path="/reports/design/view" element={<DesignReportViewPage />} />}
          <Route path="*" element={<AppLayoutRoutes />} />
        </Routes>
      </Suspense>
    </TaskProvider>
  );
}

function AppRoutes() {
  const location = useLocation();

  if (location.pathname === "/open") {
    const target = new URLSearchParams(location.search).get("target");
    return <Navigate to={getProtocolTargetPath(target) ?? "/"} replace />;
  }

  if (location.pathname === "/login") {
    return <LoginRoute />;
  }

  return (
    <ProtectedRoute>
      <AuthenticatedApp />
    </ProtectedRoute>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <PWAUpdatePrompt />
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
