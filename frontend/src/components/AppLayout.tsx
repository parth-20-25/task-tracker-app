import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { useAuth } from '@/contexts/useAuth';
import { formatEmployeeDisplay } from '@/lib/employeeDisplay';
import { PlannedTimeLoginPopup } from '@/components/ProjectPlannedTime';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, role } = useAuth();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <PlannedTimeLoginPopup />
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b px-4 bg-card">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {role?.name} · {formatEmployeeDisplay(user)}
              </span>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
