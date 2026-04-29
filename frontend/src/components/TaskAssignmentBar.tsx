import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTasks } from "@/contexts/useTasks";
import {
  fetchTaskAssignmentReferenceData,
  fetchTaskAssignmentTemplates,
  fetchTaskAssignmentUsers,
} from "@/api/taskApi";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Priority, TaskType, WorkflowTemplate } from "@/types";
import { Plus, ShieldCheck, Workflow } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const assignmentTypeOptions: Array<{ value: TaskType; label: string; hint: string }> = [
  {
    value: "department_workflow",
    label: "Department Workflow Task",
    hint: "Template-driven operational work that belongs inside department analytics.",
  },
  {
    value: "custom",
    label: "Custom Task",
    hint: "Management intervention work that stays visible but excluded from workflow analytics.",
  },
];

function toLocalDateTimeValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function buildDeadlineFromTemplate(template: WorkflowTemplate | null) {
  if (!template?.default_due_days && template?.default_due_days !== 0) {
    return "";
  }

  return toLocalDateTimeValue(new Date(Date.now() + template.default_due_days * 24 * 60 * 60 * 1000));
}

export function TaskAssignmentBar() {
  const { addTask } = useTasks();
  const [open, setOpen] = useState(false);
  const [assignmentType, setAssignmentType] = useState<TaskType>("department_workflow");
  const [departmentId, setDepartmentId] = useState("");
  const [workflowTemplateId, setWorkflowTemplateId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [deadline, setDeadline] = useState("");
  const [proofRequired, setProofRequired] = useState(true);
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [tagsInput, setTagsInput] = useState("");

  const referenceDataQuery = useQuery({
    queryKey: ["task-assignment", "reference-data"],
    queryFn: fetchTaskAssignmentReferenceData,
  });

  const templatesQuery = useQuery({
    queryKey: ["task-assignment", "templates", departmentId],
    queryFn: () => fetchTaskAssignmentTemplates(departmentId),
    enabled: open && assignmentType === "department_workflow" && !!departmentId,
  });

  const assignableUsersQuery = useQuery({
    queryKey: ["task-assignment", "users", assignmentType, departmentId, workflowTemplateId],
    queryFn: () => fetchTaskAssignmentUsers({
      task_type: assignmentType,
      department_id: assignmentType === "department_workflow" ? departmentId : departmentId || null,
      workflow_template_id: assignmentType === "department_workflow" ? workflowTemplateId || null : null,
    }),
    enabled: open && (assignmentType === "custom" || (!!departmentId && !!workflowTemplateId)),
  });

  const departments = referenceDataQuery.data?.departments ?? [];
  const templates = templatesQuery.data ?? [];
  const assignableUsers = assignableUsersQuery.data ?? [];
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === workflowTemplateId) ?? null,
    [templates, workflowTemplateId],
  );

  useEffect(() => {
    if (assignmentType === "department_workflow" && !departmentId && departments.length > 0) {
      setDepartmentId(departments[0].id);
    }
  }, [assignmentType, departmentId, departments]);

  useEffect(() => {
    if (assignmentType === "custom") {
      setWorkflowTemplateId("");
      setProofRequired(false);
      setApprovalRequired(false);
    }
  }, [assignmentType]);

  useEffect(() => {
    if (assignmentType !== "department_workflow" || !selectedTemplate) {
      return;
    }

    if (selectedTemplate.default_priority) {
      setPriority(selectedTemplate.default_priority);
    }

    setProofRequired(selectedTemplate.default_proof_required);
    setApprovalRequired(selectedTemplate.default_approval_required);

    if (!deadline) {
      setDeadline(buildDeadlineFromTemplate(selectedTemplate));
    }

    if (!title.trim()) {
      setTitle(selectedTemplate.template_name);
    }
  }, [assignmentType, deadline, selectedTemplate, title]);

  useEffect(() => {
    setAssignedTo("");
  }, [assignmentType, departmentId, workflowTemplateId]);

  const selectedUser = assignableUsers.find((user) => user.employee_id === assignedTo) ?? null;
  const tagValues = useMemo(
    () => tagsInput.split(",").map((tag) => tag.trim()).filter(Boolean),
    [tagsInput],
  );

  const canSubmit = useMemo(() => {
    if (!assignedTo || !deadline || !priority) {
      return false;
    }

    if (assignmentType === "department_workflow") {
      return !!departmentId && !!workflowTemplateId;
    }

    return !!title.trim() && !!description.trim();
  }, [assignedTo, assignmentType, deadline, departmentId, description, priority, title, workflowTemplateId]);

  const resetForm = () => {
    setAssignmentType("department_workflow");
    setDepartmentId(departments[0]?.id || "");
    setWorkflowTemplateId("");
    setAssignedTo("");
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDeadline("");
    setProofRequired(true);
    setApprovalRequired(true);
    setTagsInput("");
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    try {
      await addTask({
        task_type: assignmentType,
        title: assignmentType === "custom" ? title.trim() : selectedTemplate?.template_name || title.trim(),
        description: description.trim(),
        assigned_to: assignedTo,
        assignee_ids: [assignedTo],
        department_id: departmentId || null,
        workflow_template_id: assignmentType === "department_workflow" ? workflowTemplateId : null,
        priority,
        deadline: new Date(deadline).toISOString(),
        proof_required: proofRequired,
        approval_required: approvalRequired,
        tags: assignmentType === "custom" ? tagValues : [],
      });

      toast({
        title: assignmentType === "department_workflow" ? "Workflow task assigned" : "Custom task assigned",
        description: assignmentType === "department_workflow"
          ? "The department task was created with its workflow controls."
          : "The custom intervention task was created outside department analytics.",
      });

      resetForm();
      setOpen(false);
    } catch (error) {
      toast({
        title: "Task not assigned",
        description: error instanceof Error ? error.message : "Failed to assign task",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="animate-fade-in border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Assignment Command</h3>
          <p className="text-xs text-slate-500">Separate workflow execution from executive intervention.</p>
        </div>
        <Button variant={open ? "secondary" : "default"} size="sm" onClick={() => setOpen((value) => !value)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {open ? "Close" : "New Assignment"}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-5 p-4 pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            {assignmentTypeOptions.map((option) => {
              const selected = assignmentType === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAssignmentType(option.value)}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-900 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {option.value === "department_workflow" ? <Workflow className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    {option.label}
                  </div>
                  <p className={`mt-1 text-xs ${selected ? "text-slate-200" : "text-slate-500"}`}>{option.hint}</p>
                </button>
              );
            })}
          </div>

          {assignmentType === "department_workflow" ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Department</Label>
                  <Select value={departmentId} onValueChange={(value) => {
                    setDepartmentId(value);
                    setWorkflowTemplateId("");
                    setTitle("");
                    setDeadline("");
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Workflow Template</Label>
                  <Select value={workflowTemplateId} onValueChange={setWorkflowTemplateId} disabled={!departmentId}>
                    <SelectTrigger>
                      <SelectValue placeholder={departmentId ? "Select template" : "Choose department first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.template_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedTemplate && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{selectedTemplate.default_priority || "manual priority"}</Badge>
                    <Badge variant="secondary">{selectedTemplate.default_proof_required ? "proof required" : "proof optional"}</Badge>
                    <Badge variant="secondary">{selectedTemplate.default_approval_required ? "approval required" : "self-closing"}</Badge>
                    {selectedTemplate.default_due_days !== null && selectedTemplate.default_due_days !== undefined && (
                      <Badge variant="secondary">{selectedTemplate.default_due_days} day default SLA</Badge>
                    )}
                  </div>
                  {selectedTemplate.description && <p className="mt-2">{selectedTemplate.description}</p>}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Execution Notes</Label>
                <Textarea
                  placeholder="Optional context, dependencies, handoff notes, or escalation remarks."
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Task Title</Label>
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Vendor Delay Root Cause Investigation"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Department Tag</Label>
                  <Select value={departmentId || "none"} onValueChange={(value) => setDepartmentId(value === "none" ? "" : value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Optional department tag" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No department</SelectItem>
                      {departments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  placeholder="Explain what, why, expected outcome, and which decision depends on this task."
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Tags</Label>
                <Input
                  value={tagsInput}
                  onChange={(event) => setTagsInput(event.target.value)}
                  placeholder="urgent, executive, audit"
                />
                {tagValues.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {tagValues.map((tag) => (
                      <Badge key={tag} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Assign To</Label>
              <Select
                value={assignedTo}
                onValueChange={setAssignedTo}
                disabled={assignmentType === "department_workflow" && !workflowTemplateId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={assignmentType === "department_workflow" && !workflowTemplateId ? "Choose template first" : "Select assignee"} />
                </SelectTrigger>
                <SelectContent>
                  {assignableUsers.map((user) => (
                    <SelectItem key={user.employee_id} value={user.employee_id}>
                      {user.name} ({user.employee_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedUser && (
                <p className="text-xs text-slate-500">
                  {selectedUser.department?.name || selectedUser.department_id} • {selectedUser.role?.name || selectedUser.role_id}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Proof Required</p>
                    <p className="text-xs text-slate-500">Block completion until evidence exists.</p>
                  </div>
                  <Switch checked={proofRequired} onCheckedChange={setProofRequired} />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Approval Required</p>
                    <p className="text-xs text-slate-500">Only approval can close the task.</p>
                  </div>
                  <Switch checked={approvalRequired} onCheckedChange={setApprovalRequired} />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit || assignableUsersQuery.isLoading}>
              <Plus className="mr-1.5 h-4 w-4" />
              {assignmentType === "department_workflow" ? "Assign Workflow Task" : "Assign Custom Task"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
