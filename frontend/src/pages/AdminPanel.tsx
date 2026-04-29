import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchAuditLogs,
  fetchAllDepartments,
  fetchMachines,
  fetchRoles,
  fetchShifts,
  fetchUsers,
  saveUser,
  updateUserStatus,
  deleteUser,
  saveRole,
  deleteRole,
  saveDepartment,
  deleteDepartment,
  saveShift,
  deleteShift,
  saveMachine,
  deleteMachine,
} from "@/api/adminApi";
import { AuditLog, Department, Machine, Role, Shift, User } from "@/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/useAuth";
import { RouteContentSkeleton } from "@/components/LoadingSkeletons";
import { Building2, FileText, Settings, Shield, Users, Wrench, Clock3 } from "lucide-react";

const UsersTab = lazy(() => import("./admin/UsersTab"));
const RolesTab = lazy(() => import("./admin/RolesTab"));
const DepartmentsTab = lazy(() => import("./admin/DepartmentsTab"));
const ShiftsTab = lazy(() => import("./admin/ShiftsTab"));
const MachinesTab = lazy(() => import("./admin/MachinesTab"));
const WorkflowsTab = lazy(() => import("./admin/WorkflowsTab"));
const AuditTab = lazy(() => import("./admin/AuditTab"));

const validTabs = ["users", "roles", "departments", "shifts", "machines", "workflows", "audit"] as const;
type AdminTab = typeof validTabs[number];

export default function AdminPanel() {
  const { access } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const routeTab = location.pathname.split("/")[2];
  const availableTabs = useMemo(() => ([
    access.canManageUsers ? "users" : null,
    access.canManageRoles ? "roles" : null,
    access.canManageDepartments ? "departments" : null,
    access.canManageShifts ? "shifts" : null,
    access.canManageMachines ? "machines" : null,
    access.canManageWorkflows ? "workflows" : null,
    access.canViewAuditLogs ? "audit" : null,
  ].filter(Boolean) as AdminTab[]), [access]);
  const defaultTab = availableTabs[0] || "users";
  const currentTab = availableTabs.includes(routeTab as AdminTab) ? (routeTab as AdminTab) : defaultTab;

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    if (!availableTabs.includes(currentTab)) {
      navigate(defaultTab === "users" ? "/admin/users" : `/admin/${defaultTab}`, { replace: true });
    }
  }, [availableTabs, currentTab, defaultTab, navigate]);

  useEffect(() => {
    fetchRoles().then(setRoles).catch(() => undefined);
    fetchAllDepartments().then(setDepartments).catch(() => undefined);
  }, []);

  useEffect(() => {
    switch (currentTab) {
      case "users":
        fetchUsers("accessible").then(setUsers).catch(() => undefined);
        break;
      case "roles":
        fetchRoles().then(setRoles).catch(() => undefined);
        break;
      case "departments":
        fetchAllDepartments().then(setDepartments).catch(() => undefined);
        break;
      case "shifts":
        fetchShifts().then(setShifts).catch(() => undefined);
        break;
      case "machines":
        fetchMachines().then(setMachines).catch(() => undefined);
        break;
      case "audit":
        fetchAuditLogs().then(setAuditLogs).catch(() => undefined);
        break;
      default:
        break;
    }
  }, [currentTab]);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">Admin Panel</h1>
      <Tabs
        value={currentTab}
        onValueChange={(value) => navigate(value === "users" ? "/admin/users" : `/admin/${value}`)}
      >
        <TabsList>
          {access.canManageUsers && <TabsTrigger value="users"><Users className="h-3.5 w-3.5 mr-1.5" />Users</TabsTrigger>}
          {access.canManageRoles && <TabsTrigger value="roles"><Shield className="h-3.5 w-3.5 mr-1.5" />Roles</TabsTrigger>}
          {access.canManageDepartments && <TabsTrigger value="departments"><Building2 className="h-3.5 w-3.5 mr-1.5" />Departments</TabsTrigger>}
          {access.canManageShifts && <TabsTrigger value="shifts"><Clock3 className="h-3.5 w-3.5 mr-1.5" />Shifts</TabsTrigger>}
          {access.canManageMachines && <TabsTrigger value="machines"><Wrench className="h-3.5 w-3.5 mr-1.5" />Machines</TabsTrigger>}
          {access.canManageWorkflows && <TabsTrigger value="workflows"><Settings className="h-3.5 w-3.5 mr-1.5" />Workflows</TabsTrigger>}
          {access.canViewAuditLogs && <TabsTrigger value="audit"><FileText className="h-3.5 w-3.5 mr-1.5" />Audit Logs</TabsTrigger>}
        </TabsList>

        {access.canManageUsers && <TabsContent value="users" className="mt-4">
          <Suspense fallback={<RouteContentSkeleton />}>
            <UsersTab
              users={users}
              roles={roles}
              departments={departments}
              onSave={async (payload) => {
                try {
                  await saveUser(payload.employee_id, payload);
                  setUsers(await fetchUsers("accessible"));
                  toast({ title: `User ${payload.employee_id} saved` });
                } catch (error) {
                  toast({ title: "User save failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
              onToggleStatus={async (employeeId, isActive) => {
                try {
                  await updateUserStatus(employeeId, isActive);
                  setUsers(await fetchUsers("accessible"));
                  toast({ title: `User ${isActive ? "activated" : "deactivated"}` });
                } catch (error) {
                  toast({ title: "User status update failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
              onDelete={async (employeeId) => {
                try {
                  await deleteUser(employeeId);
                  setUsers(await fetchUsers("accessible"));
                  toast({ title: `User ${employeeId} deleted` });
                } catch (error) {
                  toast({ title: "User delete failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
            />
          </Suspense>
        </TabsContent>}

        {access.canManageRoles && <TabsContent value="roles" className="mt-4">
          <Suspense fallback={<RouteContentSkeleton />}>
            <RolesTab
              roles={roles}
              onSave={async (payload) => {
                try {
                  setRoles(await saveRole(payload.id, payload));
                  toast({ title: `Role ${payload.id} saved` });
                } catch (error) {
                  toast({ title: "Role save failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
              onDelete={async (roleId) => {
                try {
                  await deleteRole(roleId);
                  setRoles(await fetchRoles());
                  toast({ title: `Role ${roleId} deactivated` });
                } catch (error) {
                  toast({ title: "Role delete failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
            />
          </Suspense>
        </TabsContent>}

        {access.canManageDepartments && <TabsContent value="departments" className="mt-4">
          <Suspense fallback={<RouteContentSkeleton />}>
            <DepartmentsTab
              departments={departments}
              onSave={async (payload) => {
                try {
                  setDepartments(await saveDepartment(payload.id, payload));
                  toast({ title: `Department ${payload.id} saved` });
                } catch (error) {
                  toast({ title: "Department save failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
              onDelete={async (departmentId) => {
                try {
                  await deleteDepartment(departmentId);
                  setDepartments(await fetchAllDepartments());
                  toast({ title: `Department ${departmentId} deactivated` });
                } catch (error) {
                  toast({ title: "Department delete failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
            />
          </Suspense>
        </TabsContent>}

        {access.canManageShifts && <TabsContent value="shifts" className="mt-4">
          <Suspense fallback={<RouteContentSkeleton />}>
            <ShiftsTab
              shifts={shifts}
              onSave={async (payload) => {
                try {
                  setShifts(await saveShift(payload.id, payload));
                  toast({ title: `Shift ${payload.id} saved` });
                } catch (error) {
                  toast({ title: "Shift save failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
              onDelete={async (shiftId) => {
                try {
                  await deleteShift(shiftId);
                  setShifts(await fetchShifts());
                  toast({ title: `Shift ${shiftId} deleted` });
                } catch (error) {
                  toast({ title: "Shift delete failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
            />
          </Suspense>
        </TabsContent>}

        {access.canManageMachines && <TabsContent value="machines" className="mt-4">
          <Suspense fallback={<RouteContentSkeleton />}>
            <MachinesTab
              machines={machines}
              departments={departments}
              onSave={async (payload) => {
                try {
                  setMachines(await saveMachine(payload.id, payload));
                  toast({ title: `Machine ${payload.id} saved` });
                } catch (error) {
                  toast({ title: "Machine save failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
              onDelete={async (machineId) => {
                try {
                  await deleteMachine(machineId);
                  setMachines(await fetchMachines());
                  toast({ title: `Machine ${machineId} deleted` });
                } catch (error) {
                  toast({ title: "Machine delete failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
                  throw error;
                }
              }}
            />
          </Suspense>
        </TabsContent>}

        {access.canManageWorkflows && <TabsContent value="workflows" className="mt-4">
          <Suspense fallback={<RouteContentSkeleton />}>
            <WorkflowsTab />
          </Suspense>
        </TabsContent>}

        {access.canViewAuditLogs && <TabsContent value="audit" className="mt-4">
          <Suspense fallback={<RouteContentSkeleton />}>
            <AuditTab auditLogs={auditLogs} />
          </Suspense>
        </TabsContent>}
      </Tabs>
    </div>
  );
}
