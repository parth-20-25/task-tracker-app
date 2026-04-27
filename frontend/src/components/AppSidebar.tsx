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
  const { user, role, logout, hasPermission } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const isAdmin = role?.hierarchy_level === 1;
  const isSupervisor = (role?.hierarchy_level ?? 99) <= 4;
  const canAccessAnalytics = [
    'view_self_user',
    'view_self_department',
    'view_department_comparison',
    'view_user_comparison',
  ].some((permissionId) => hasPermission(permissionId));

  const mainItems = [
    { title: 'Dashboard', url: '/', icon: LayoutDashboard },
    { title: 'My Tasks', url: '/tasks', icon: ClipboardList },
    { title: 'Notifications', url: '/notifications', icon: Bell },
    { title: 'Issues', url: '/issues', icon: MessageSquareWarning },
    { title: 'Batches', url: '/batches', icon: PackageCheck },
  ];

  const supervisorItems = [];

  if (isSupervisor) {
    supervisorItems.push(
      { title: 'Team Tasks', url: '/team-tasks', icon: ClipboardList },
      { title: 'Verifications', url: '/verifications', icon: Shield },
      { title: 'Reports', url: '/reports', icon: FileText },
    );
  }

  if (canAccessAnalytics) {
    supervisorItems.splice(Math.min(2, supervisorItems.length), 0, { title: 'Analytics', url: '/analytics', icon: BarChart3 });
  }

  const adminItems = [
    { title: 'Users', url: '/admin/users', icon: Users },
    { title: 'Roles', url: '/admin/roles', icon: Shield },
    { title: 'Departments', url: '/admin/departments', icon: Building2 },
    { title: 'Workflow Rules', url: '/admin/workflows', icon: Settings },
    { title: 'Audit Logs', url: '/admin/audit', icon: FileText },
  ];

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

        {supervisorItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{isSupervisor ? 'Supervisor' : 'Analytics'}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {supervisorItems.map(item => (
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

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
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
