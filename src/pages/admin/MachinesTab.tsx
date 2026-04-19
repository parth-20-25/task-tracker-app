import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Department, Machine } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface MachinesTabProps {
  machines: Machine[];
  departments: Department[];
  onSave: (payload: Machine) => Promise<void>;
  onDelete: (machineId: string) => Promise<void>;
}

const EMPTY_FORM: Machine = {
  id: "",
  name: "",
  department_id: "",
  location: "",
};

export default function MachinesTab({ machines, departments, onSave, onDelete }: MachinesTabProps) {
  const [form, setForm] = useState<Machine>(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Edit Machine" : "Create Machine"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Machine ID</Label>
              <Input value={form.id} disabled={isEditing} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={form.department_id || "__none__"} onValueChange={(value) => setForm((current) => ({ ...current, department_id: value === "__none__" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No department</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input value={form.location || ""} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} />
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
              {isEditing ? "Update Machine" : "Create Machine"}
            </Button>
            {isEditing && <Button variant="outline" onClick={() => { setIsEditing(false); setForm(EMPTY_FORM); }}>Cancel</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {machines.map((machine) => (
                <TableRow key={machine.id}>
                  <TableCell className="font-mono text-xs">{machine.id}</TableCell>
                  <TableCell>{machine.name}</TableCell>
                  <TableCell>{departments.find((department) => department.id === machine.department_id)?.name || "—"}</TableCell>
                  <TableCell>{machine.location || "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setIsEditing(true); setForm(machine); }}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Delete machine ${machine.name}?`)) onDelete(machine.id).catch(() => undefined); }}>
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
