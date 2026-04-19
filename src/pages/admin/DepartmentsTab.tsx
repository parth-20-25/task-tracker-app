import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Department } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DepartmentsTabProps {
  departments: Department[];
  onSave: (payload: Department) => Promise<void>;
  onDelete: (departmentId: string) => Promise<void>;
}

const EMPTY_FORM: Department = {
  id: "",
  name: "",
  parent_department: undefined,
  is_active: true,
};

export default function DepartmentsTab({ departments, onSave, onDelete }: DepartmentsTabProps) {
  const [form, setForm] = useState<Department>(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const availableParentDepartments = departments.filter(
    (department) => department.id !== form.id && (department.is_active !== false || department.id === form.parent_department),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Edit Department" : "Create Department"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Department ID</Label>
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
              <Label>Parent Department</Label>
              <Select value={form.parent_department || "__none__"} onValueChange={(value) => setForm((current) => ({ ...current, parent_department: value === "__none__" ? undefined : value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No parent</SelectItem>
                  {availableParentDepartments.map((department) => (
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
              {isEditing ? "Update Department" : "Create Department"}
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
        {departments.map((department) => {
          const parent = departments.find((item) => item.id === department.parent_department);

          return (
            <Card key={department.id}>
              <CardContent className="p-4 space-y-3">
                <div>
                  <h4 className="font-medium">{department.name}</h4>
                  <p className="text-xs text-muted-foreground">{department.id}</p>
                </div>
                <p className="text-xs text-muted-foreground">Parent: {parent?.name || "—"}</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditing(true);
                      setForm({
                        ...department,
                        is_active: department.is_active !== false,
                      });
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={department.is_active === false}
                    onClick={() => {
                      if (confirm(`Deactivate department ${department.name}? Existing user assignments must be cleared first.`)) {
                        onDelete(department.id).catch(() => undefined);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {department.is_active === false ? "Inactive" : "Deactivate"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Status: {department.is_active === false ? "Inactive" : "Active"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
