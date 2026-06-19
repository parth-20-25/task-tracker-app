import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/useAuth";
import { TaskProvider } from "@/contexts/TaskContext";
import { AppLayout } from "@/components/AppLayout";
import { AppBootSkeleton, RouteContentSkeleton } from "@/components/LoadingSkeletons";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import Login from "./pages/Login";
import React, { Suspense } from "react";
import { isDesignDepartment } from "@/lib/departments";
import { isProjectAuthorityUser } from "@/lib/permissions";

const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const MyTasks = React.lazy(() => import("./pages/MyTasks"));
const TaskDetail = React.lazy(() => import("./pages/TaskDetail"));
const TeamTasks = React.lazy(() => import("./pages/TeamTasks"));
const AdminPanel = React.lazy(() => import("./pages/AdminPanel"));
const Analytics = React.lazy(() => import("./pages/Analytics/AnalyticsDashboard"));
const Reports = React.lazy(() => import("./pages/Reports"));
const DesignReportViewPage = React.lazy(() => import("./pages/DesignReportViewPage"));
const Batches = React.lazy(() => import("./pages/Batches"));
const Issues = React.lazy(() => import("./pages/Issues"));
const AdditionalDesignTasks = React.lazy(() => import("./pages/AdditionalDesignTasks"));
const NotFound = React.lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function AppLayoutRoutes() {
  const { access, user } = useAuth();
  const canAccessAdditionalDesignTasks = isDesignDepartment(user) || isProjectAuthorityUser(user);

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<MyTasks />} />
        <Route path="/tasks/:taskId" element={<TaskDetail />} />
        <Route path="/issues" element={<Issues />} />
        <Route path="/batches" element={<Batches />} />
        {canAccessAdditionalDesignTasks && <Route path="/additional-design-tasks" element={<AdditionalDesignTasks />} />}
        {access.canViewTeamTasks && <Route path="/team-tasks" element={<TeamTasks />} />}
        {access.canViewAnalytics && <Route path="/analytics/*" element={<Analytics />} />}
        {access.canViewReports && <Route path="/reports" element={<Reports />} />}
        {access.canAccessAdminPanel && <Route path="/admin/*" element={<AdminPanel />} />}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, isReady, access } = useAuth();

  if (!isReady) {
    return <AppBootSkeleton />;
  }

  if (!isAuthenticated) return <Login />;

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <PWAUpdatePrompt />
      <AuthProvider>
        <BrowserRouter>
          <AuthenticatedApp />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
