import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Role } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERMISSION_OPTIONS } from "@/lib/permissions";

interface RolesTabProps {
  roles: Role[];
  onSave: (payload: Role) => Promise<void>;
  onDelete: (roleId: string) => Promise<void>;
}

const EMPTY_FORM: Role = {
  id: "",
  name: "",
  hierarchy_level: 1,
  permissions: {},
  scope: "global",
  parent_role: undefined,
  is_active: true,
};

export default function RolesTab({ roles, onSave, onDelete }: RolesTabProps) {
  const [form, setForm] = useState<Role>(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const availableParentRoles = roles.filter((role) => role.id !== form.id && (role.is_active !== false || role.id === form.parent_role));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Edit Role" : "Create Role"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Role ID</Label>
              <Input
                value={form.id}
                disabled={isEditing}
                onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
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
              <Label>Hierarchy Level</Label>
              <Input
                type="number"
                min="1"
                value={form.hierarchy_level}
                onChange={(event) => setForm((current) => ({ ...current, hierarchy_level: Number(event.target.value) || 1 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={form.scope} onValueChange={(value) => setForm((current) => ({ ...current, scope: value as Role["scope"] }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="department">Department</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="self">Self</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.is_active === false ? "inactive" : "active"}
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

          <div className="space-y-2">
            <Label>Parent Role</Label>
            <Select value={form.parent_role || "__none__"} onValueChange={(value) => setForm((current) => ({ ...current, parent_role: value === "__none__" ? undefined : value }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No parent role</SelectItem>
                {availableParentRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Permissions</Label>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
              {PERMISSION_OPTIONS.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-sm border rounded px-3 py-2">
                  <Checkbox
                    checked={Boolean(form.permissions[permission])}
                    onCheckedChange={(checked) => {
                      setForm((current) => ({
                        ...current,
                        permissions: {
                          ...current.permissions,
                          [permission]: checked === true,
                        },
                      }));
                    }}
                  />
                  <span>{permission}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => {
                onSave(form).then(() => {
                  setIsEditing(false);
                  setForm(EMPTY_FORM);
                });
              }}
              disabled={!form.id || !form.name}
            >
              {isEditing ? "Update Role" : "Create Role"}
            </Button>
            {isEditing && (
              <Button variant="outline" onClick={() => {
                setIsEditing(false);
                setForm(EMPTY_FORM);
              }}>
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {roles.map((role) => (
          <Card key={role.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{role.name}</h4>
                  <p className="text-xs text-muted-foreground">{role.id}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline">Level {role.hierarchy_level}</Badge>
                  <Badge variant={role.is_active === false ? "secondary" : "outline"}>
                    {role.is_active === false ? "Inactive" : "Active"}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Scope: {role.scope}</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(role.permissions).filter(([, enabled]) => enabled).map(([permission]) => (
                  <Badge key={permission} variant="secondary" className="text-[10px]">
                    {permission}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditing(true);
                      setForm({
                        ...role,
                        permissions: { ...role.permissions },
                        is_active: role.is_active !== false,
                      });
                    }}
                  >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={role.is_active === false}
                    onClick={() => {
                      if (confirm(`Deactivate role ${role.name}? Existing user assignments must be cleared first.`)) {
                        onDelete(role.id).catch(() => undefined);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {role.is_active === false ? "Inactive" : "Deactivate"}
                  </Button>
                </div>
              </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
