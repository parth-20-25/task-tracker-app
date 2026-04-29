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
import Login from "./pages/Login";
import React, { Suspense } from "react";

const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const MyTasks = React.lazy(() => import("./pages/MyTasks"));
const TeamTasks = React.lazy(() => import("./pages/TeamTasks"));
const Verifications = React.lazy(() => import("./pages/Verifications"));
const AdminPanel = React.lazy(() => import("./pages/AdminPanel"));
const Notifications = React.lazy(() => import("./pages/Notifications"));
const Analytics = React.lazy(() => import("./pages/Analytics/AnalyticsDashboard"));
const Reports = React.lazy(() => import("./pages/Reports"));
const Batches = React.lazy(() => import("./pages/Batches"));
const Issues = React.lazy(() => import("./pages/Issues"));
const NotFound = React.lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function AuthenticatedApp() {
  const { isAuthenticated, isReady, access } = useAuth();

  if (!isReady) {
    return <AppBootSkeleton />;
  }

  if (!isAuthenticated) return <Login />;

  return (
    <TaskProvider>
      <AppLayout>
        <Suspense fallback={<RouteContentSkeleton />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tasks" element={<MyTasks />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/issues" element={<Issues />} />
            <Route path="/batches" element={<Batches />} />
            {access.canViewTeamTasks && <Route path="/team-tasks" element={<TeamTasks />} />}
            {access.canViewVerifications && <Route path="/verifications" element={<Verifications />} />}
            {access.canViewAnalytics && <Route path="/analytics/*" element={<Analytics />} />}
            {access.canViewReports && <Route path="/reports" element={<Reports />} />}
            {access.canAccessAdminPanel && <Route path="/admin/*" element={<AdminPanel />} />}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AppLayout>
    </TaskProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <AuthenticatedApp />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
