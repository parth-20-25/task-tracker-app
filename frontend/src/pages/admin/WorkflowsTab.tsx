import React, { useEffect, useMemo, useState } from "react";
import { fetchDepartments, fetchWorkflow, fetchWorkflows, createWorkflow, updateWorkflow, deleteWorkflow } from "@/api/adminApi";
import { Department, Workflow } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { generateUUID } from "@/lib/uuid";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

type EditableStage = {
  id: string;
  stage_name: string;
};

type WorkflowFormState = {
  id: string | null;
  name: string;
  description: string;
  department_id: string;
  stages: EditableStage[];
};

const emptyForm = (): WorkflowFormState => ({
  id: null,
  name: "",
  description: "",
  department_id: "",
  stages: [{ id: generateUUID(), stage_name: "" }],
});

function normalizeWorkflow(workflow: Workflow): WorkflowFormState {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description || "",
    department_id: workflow.department_id || "",
    stages: (workflow.stages || []).map((stage) => ({
      id: stage.id,
      stage_name: stage.stage_name || stage.name,
    })),
  };
}

export default function WorkflowsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [form, setForm] = useState<WorkflowFormState>(emptyForm);

  const activeDepartments = useMemo(
    () => departments.filter((department) => department.is_active !== false),
    [departments],
  );

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [departmentData, workflowSummaries] = await Promise.all([
        fetchDepartments(),
        fetchWorkflows(),
      ]);
      const workflowDetails = await Promise.all(
        workflowSummaries.map((workflow) => fetchWorkflow(workflow.id)),
      );

      setDepartments(departmentData);
      setWorkflows(workflowDetails);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load workflows",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function updateStage(stageId: string, stageName: string) {
    setForm((current) => ({
      ...current,
      stages: current.stages.map((stage) => (
        stage.id === stageId
          ? { ...stage, stage_name: stageName }
          : stage
      )),
    }));
  }

  function addStage() {
    setForm((current) => ({
      ...current,
      stages: [...current.stages, { id: generateUUID(), stage_name: "" }],
    }));
  }

  function deleteStage(stageId: string) {
    setForm((current) => {
      if (current.stages.length === 1) {
        return current;
      }

      return {
        ...current,
        stages: current.stages.filter((stage) => stage.id !== stageId),
      };
    });
  }

  function moveStage(stageId: string, direction: "up" | "down") {
    setForm((current) => {
      const index = current.stages.findIndex((stage) => stage.id === stageId);
      const swapIndex = direction === "up" ? index - 1 : index + 1;

      if (index < 0 || swapIndex < 0 || swapIndex >= current.stages.length) {
        return current;
      }

      const nextStages = [...current.stages];
      const [stage] = nextStages.splice(index, 1);
      nextStages.splice(swapIndex, 0, stage);

      return {
        ...current,
        stages: nextStages,
      };
    });
  }

  function resetForm() {
    setForm(emptyForm());
  }

  function editWorkflow(workflow: Workflow) {
    setForm(normalizeWorkflow(workflow));
  }

  async function handleSaveWorkflow() {
    const trimmedName = form.name.trim();
    const normalizedStages = form.stages.map((stage) => ({
      ...stage,
      stage_name: stage.stage_name.trim(),
    }));

    if (!trimmedName) {
      toast({ title: "Validation error", description: "Workflow name is required", variant: "destructive" });
      return;
    }

    if (!form.department_id) {
      toast({ title: "Validation error", description: "Department is required", variant: "destructive" });
      return;
    }

    if (normalizedStages.length === 0) {
      toast({ title: "Validation error", description: "At least one stage is required", variant: "destructive" });
      return;
    }

    if (normalizedStages.some((stage) => !stage.stage_name)) {
      toast({ title: "Validation error", description: "Stage names cannot be empty", variant: "destructive" });
      return;
    }

    const duplicateWorkflow = workflows.find(
      (workflow) => workflow.department_id === form.department_id && workflow.id !== form.id,
    );
    if (duplicateWorkflow) {
      toast({ title: "Validation error", description: "This department already has a workflow", variant: "destructive" });
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name: trimmedName,
        description: form.description.trim(),
        department_id: form.department_id,
        stages: normalizedStages,
      };

      if (form.id) {
        await updateWorkflow(form.id, payload as any);
      } else {
        await createWorkflow(payload as any);
      }

      await loadData();
      resetForm();
      toast({ title: "Success", description: "Workflow saved successfully" });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save workflow",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteWorkflow(workflowId: string) {
    if (!window.confirm("Delete this workflow? This is only allowed when no active tasks use it.")) {
      return;
    }

    try {
      await deleteWorkflow(workflowId);
      await loadData();
      if (form.id === workflowId) {
        resetForm();
      }
      toast({ title: "Success", description: "Workflow deleted" });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Failed to delete workflow",
        variant: "destructive",
      });
    }
  }

  const preview = form.stages
    .map((stage) => stage.stage_name.trim())
    .filter(Boolean)
    .join(" \u2192 ");

  if (loading) {
    return <div className="flex h-64 items-center justify-center">Loading workflows...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{form.id ? "Edit Workflow" : "Create Workflow"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="workflow-name">Workflow Name</Label>
              <Input
                id="workflow-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Enter workflow name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="workflow-department">Department</Label>
              <select
                id="workflow-department"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.department_id}
                onChange={(event) => setForm((current) => ({ ...current, department_id: event.target.value }))}
              >
                <option value="">Select department</option>
                {activeDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workflow-description">Description</Label>
            <Textarea
              id="workflow-description"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Optional description"
              rows={3}
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Stage Builder</h3>
                <p className="text-sm text-muted-foreground">Add, rename, delete, and reorder stages.</p>
              </div>
              <Button type="button" variant="outline" onClick={addStage}>
                <Plus className="mr-2 h-4 w-4" />
                Add Stage
              </Button>
            </div>

            <div className="space-y-3">
              {form.stages.map((stage, index) => (
                <div key={stage.id} className="flex items-center gap-2 rounded-lg border p-3">
                  <Badge variant="secondary">#{index + 1}</Badge>
                  <Input
                    value={stage.stage_name}
                    onChange={(event) => updateStage(stage.id, event.target.value)}
                    placeholder={`Stage ${index + 1}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => moveStage(stage.id, "up")}
                    disabled={index === 0}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => moveStage(stage.id, "down")}
                    disabled={index === form.stages.length - 1}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteStage(stage.id)}
                    disabled={form.stages.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium">Sequence Preview</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {preview || "Add at least one named stage to preview the workflow sequence."}
            </p>
          </div>

          <div className="flex gap-3">
            <Button type="button" onClick={handleSaveWorkflow} disabled={saving}>
              Save Workflow
            </Button>
            {form.id && (
              <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                Cancel Edit
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {workflows.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No workflows configured yet.
            </CardContent>
          </Card>
        ) : (
          workflows.map((workflow) => {
            const departmentName = departments.find((department) => department.id === workflow.department_id)?.name || "Unassigned";
            const stagePreview = (workflow.stages || [])
              .map((stage) => stage.stage_name || stage.name)
              .join(" \u2192 ");

            return (
              <Card key={workflow.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <CardTitle>{workflow.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{workflow.description || "No description"}</p>
                      <Badge variant="outline">{departmentName}</Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => editWorkflow(workflow)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => handleDeleteWorkflow(workflow.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">Sequence Preview</p>
                    <p className="text-sm text-muted-foreground">{stagePreview || "No stages configured"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(workflow.stages || []).map((stage, index) => (
                      <Badge key={stage.id} variant={index === workflow.stages!.length - 1 ? "default" : "secondary"}>
                        {stage.stage_name || stage.name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
