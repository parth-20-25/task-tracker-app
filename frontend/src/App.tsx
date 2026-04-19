import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/useAuth";
import { TaskProvider } from "@/contexts/TaskContext";
import { AppLayout } from "@/components/AppLayout";
import Login from "./pages/Login";
import React, { Suspense } from "react";

const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const MyTasks = React.lazy(() => import("./pages/MyTasks"));
const TeamTasks = React.lazy(() => import("./pages/TeamTasks"));
const Verifications = React.lazy(() => import("./pages/Verifications"));
const AdminPanel = React.lazy(() => import("./pages/AdminPanel"));
const Notifications = React.lazy(() => import("./pages/Notifications"));
const Analytics = React.lazy(() => import("./pages/Analytics"));
const Reports = React.lazy(() => import("./pages/Reports"));
const NotFound = React.lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function AuthenticatedApp() {
  const { isAuthenticated, isReady, role } = useAuth();

  if (!isReady) {
    return null;
  }

  if (!isAuthenticated) return <Login />;

  const isAdmin = role?.hierarchy_level === 1;
  const isSupervisor = (role?.hierarchy_level ?? 99) <= 4;

  return (
    <TaskProvider>
      <AppLayout>
        <Suspense fallback={<div>Loading...</div>}>          
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tasks" element={<MyTasks />} />
            <Route path="/notifications" element={<Notifications />} />
            {isSupervisor && <Route path="/team-tasks" element={<TeamTasks />} />}
            {isSupervisor && <Route path="/verifications" element={<Verifications />} />}
            {isSupervisor && <Route path="/analytics" element={<Analytics />} />}
            {isSupervisor && <Route path="/reports" element={<Reports />} />}
            {isAdmin && <Route path="/admin/*" element={<AdminPanel />} />}
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
