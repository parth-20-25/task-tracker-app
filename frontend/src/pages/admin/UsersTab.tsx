import { useEffect, useState } from "react";
import { CheckCircle2, Pencil, Trash2, XCircle } from "lucide-react";
import { Department, Role, User } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface UsersTabProps {
  users: User[];
  roles: Role[];
  departments: Department[];
  onSave: (payload: {
    employee_id: string;
    name: string;
    password?: string;
    role_id: string;
    department_id?: string;
    is_active: boolean;
  }) => Promise<void>;
  onToggleStatus: (employeeId: string, isActive: boolean) => Promise<void>;
  onDelete: (employeeId: string) => Promise<void>;
}

const EMPTY_FORM = {
  employee_id: "",
  name: "",
  password: "",
  role_id: "",
  department_id: "",
  is_active: true,
};

export default function UsersTab({ users, roles, departments, onSave, onToggleStatus, onDelete }: UsersTabProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const availableRoles = roles.filter((role) => role.id === form.role_id || role.is_active !== false);
  const availableDepartments = departments.filter(
    (department) => department.id === form.department_id || department.is_active !== false,
  );

  useEffect(() => {
    if (!isEditing) {
      setForm(EMPTY_FORM);
    }
  }, [isEditing]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Edit User" : "Create User"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Employee ID</Label>
              <Input
                value={form.employee_id}
                disabled={isEditing}
                onChange={(event) => setForm((current) => ({ ...current, employee_id: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Password {isEditing ? "(create only)" : "*"}</Label>
              <Input
                type="password"
                disabled={isEditing}
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role_id} onValueChange={(value) => setForm((current) => ({ ...current, role_id: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={form.department_id || "__none__"} onValueChange={(value) => setForm((current) => ({ ...current, department_id: value === "__none__" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No department</SelectItem>
                  {availableDepartments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.is_active ? "active" : "inactive"}
                onValueChange={(value) => setForm((current) => ({ ...current, is_active: value === "active" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => {
                onSave({
                  employee_id: form.employee_id.trim(),
                  name: form.name.trim(),
                  role_id: form.role_id,
                  department_id: form.department_id || undefined,
                  is_active: form.is_active,
                  ...(!isEditing && { password: form.password.trim() || undefined }),
                }).then(() => {
                  setIsEditing(false);
                  setForm(EMPTY_FORM);
                });
              }}
              disabled={!form.employee_id || !form.name || !form.role_id || (!isEditing && !form.password)}
            >
              {isEditing ? "Update User" : "Create User"}
            </Button>
            {isEditing && (
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.employee_id}>
                  <TableCell className="font-mono text-xs">{user.employee_id}</TableCell>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.role?.name || user.role_id}</TableCell>
                  <TableCell>{user.department?.name || "—"}</TableCell>
                  <TableCell>
                    {user.is_active ? (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-3 w-3" />Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-destructive">
                        <XCircle className="h-3 w-3" />Inactive
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsEditing(true);
                          setForm({
                            employee_id: user.employee_id,
                            name: user.name,
                            password: "",
                            role_id: user.role_id,
                            department_id: user.department_id || "",
                            is_active: user.is_active,
                          });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onToggleStatus(user.employee_id, !user.is_active).catch(() => undefined);
                        }}
                      >
                        {user.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete user ${user.employee_id}? This is only allowed when there are no task dependencies.`)) {
                            onDelete(user.employee_id).catch(() => undefined);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
