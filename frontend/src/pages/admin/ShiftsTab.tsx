import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Shift } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ShiftsTabProps {
  shifts: Shift[];
  onSave: (payload: Shift) => Promise<void>;
  onDelete: (shiftId: string) => Promise<void>;
}

const EMPTY_FORM: Shift = {
  id: "",
  name: "",
  start_time: "",
  end_time: "",
};

export default function ShiftsTab({ shifts, onSave, onDelete }: ShiftsTabProps) {
  const [form, setForm] = useState<Shift>(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Edit Shift" : "Create Shift"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Shift ID</Label>
              <Input value={form.id} disabled={isEditing} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input type="time" value={form.start_time} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input type="time" value={form.end_time} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} />
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
              disabled={!form.id || !form.name || !form.start_time || !form.end_time}
            >
              {isEditing ? "Update Shift" : "Create Shift"}
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
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map((shift) => (
                <TableRow key={shift.id}>
                  <TableCell className="font-mono text-xs">{shift.id}</TableCell>
                  <TableCell>{shift.name}</TableCell>
                  <TableCell>{shift.start_time}</TableCell>
                  <TableCell>{shift.end_time}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setIsEditing(true); setForm(shift); }}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Delete shift ${shift.name}?`)) onDelete(shift.id).catch(() => undefined); }}>
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
