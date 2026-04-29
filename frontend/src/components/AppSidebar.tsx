import {
  LayoutDashboard, ClipboardList, Users, Settings, Shield, Building2, FileText, LogOut, ChevronDown, Bell, BarChart3,
  MessageSquareWarning, PackageCheck,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/contexts/useAuth';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter,
} from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/sidebar-context';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function AppSidebar() {
  const { user, role, access, logout } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  const mainItems = [
    { title: 'Dashboard', url: '/', icon: LayoutDashboard },
    { title: 'My Tasks', url: '/tasks', icon: ClipboardList },
    { title: 'Notifications', url: '/notifications', icon: Bell },
    { title: 'Issues', url: '/issues', icon: MessageSquareWarning },
    { title: 'Batches', url: '/batches', icon: PackageCheck },
  ];

  const workItems = [
    access.canViewTeamTasks ? { title: 'Team Tasks', url: '/team-tasks', icon: ClipboardList } : null,
    access.canViewVerifications ? { title: 'Verifications', url: '/verifications', icon: Shield } : null,
    access.canViewAnalytics ? { title: 'Analytics', url: '/analytics', icon: BarChart3 } : null,
    access.canViewReports ? { title: 'Reports', url: '/reports', icon: FileText } : null,
  ].filter(Boolean);

  const adminItems = [
    access.canManageUsers ? { title: 'Users', url: '/admin/users', icon: Users } : null,
    access.canManageRoles ? { title: 'Roles', url: '/admin/roles', icon: Shield } : null,
    access.canManageDepartments ? { title: 'Departments', url: '/admin/departments', icon: Building2 } : null,
    access.canManageShifts ? { title: 'Shifts', url: '/admin/shifts', icon: Settings } : null,
    access.canManageMachines ? { title: 'Machines', url: '/admin/machines', icon: Building2 } : null,
    access.canManageWorkflows ? { title: 'Workflow Rules', url: '/admin/workflows', icon: Settings } : null,
    access.canViewAuditLogs ? { title: 'Audit Logs', url: '/admin/audit', icon: FileText } : null,
  ].filter(Boolean);

  const initials = user?.name?.split(' ').map(n => n[0]).join('') || '?';

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="p-4 flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <Settings className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && <span className="font-semibold text-sm text-sidebar-foreground">TaskControl</span>}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map(item => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {workItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Work</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {workItems.map(item => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink to={item.url} end className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                        <item.icon className="mr-2 h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {adminItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Management</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map(item => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink to={item.url} end className="hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                        <item.icon className="mr-2 h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3">
        <Separator className="mb-3 bg-sidebar-border" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 w-full rounded-md p-2 hover:bg-sidebar-accent transition-colors text-left">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">{initials}</AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-sidebar-foreground truncate">{user?.name}</p>
                  <p className="text-[10px] text-sidebar-foreground/60">{role?.name}</p>
                </div>
              )}
              {!collapsed && <ChevronDown className="h-3 w-3 text-sidebar-foreground/60" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={logout} className="text-destructive text-xs">
              <LogOut className="h-3 w-3 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
