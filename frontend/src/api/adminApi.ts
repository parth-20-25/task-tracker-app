import { apiRequest } from "@/api/http";
import { setCachedDepartments } from "@/lib/referenceDataCache";
import {
  AuditLog,
  Department,
  EscalationRule,
  KpiDefinition,
  Machine,
  Role,
  Shift,
  User,
  Workflow,
  WorkflowStage,
  WorkflowTransition,
} from "@/types";

export function fetchUsers(scope: "accessible" | "assignable" = "accessible") {
  return apiRequest<User[]>(`/users?scope=${scope}`);
}

export function fetchRoles() {
  return apiRequest<Role[]>("/roles");
}

export function fetchDepartments() {
  return apiRequest<Department[]>("/departments");
}

export function fetchAllDepartments() {
  return apiRequest<Department[]>("/all-departments").then((response) => {
    setCachedDepartments("all-departments", response);
    return response;
  });
}

export function fetchAuditLogs() {
  return apiRequest<AuditLog[]>("/audit-logs");
}

export function saveUser(employeeId: string, payload: Partial<User> & { password?: string }) {
  return apiRequest<User>(`/users/${employeeId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function updateUserStatus(employeeId: string, isActive: boolean) {
  return apiRequest<User>(`/users/${employeeId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: isActive }),
  });
}

export function deleteUser(employeeId: string) {
  return apiRequest<{ success?: boolean }>(`/users/${employeeId}`, {
    method: "DELETE",
  });
}

export function saveRole(roleId: string, payload: Partial<Role>) {
  return apiRequest<Role[]>(`/roles/${roleId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteRole(roleId: string) {
  return apiRequest<{ success?: boolean }>(`/roles/${roleId}`, {
    method: "DELETE",
  });
}

export function saveDepartment(departmentId: string, payload: Partial<Department>) {
  return apiRequest<Department[]>(`/departments/${departmentId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteDepartment(departmentId: string) {
  return apiRequest<{ success?: boolean }>(`/departments/${departmentId}`, {
    method: "DELETE",
  });
}

export function fetchShifts() {
  return apiRequest<Shift[]>("/shifts");
}

export function saveShift(shiftId: string, payload: Partial<Shift>) {
  return apiRequest<Shift[]>(`/shifts/${shiftId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteShift(shiftId: string) {
  return apiRequest<{ success?: boolean }>(`/shifts/${shiftId}`, {
    method: "DELETE",
  });
}

export function fetchMachines() {
  return apiRequest<Machine[]>("/machines");
}

export function saveMachine(machineId: string, payload: Partial<Machine>) {
  return apiRequest<Machine[]>(`/machines/${machineId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteMachine(machineId: string) {
  return apiRequest<{ success?: boolean }>(`/machines/${machineId}`, {
    method: "DELETE",
  });
}

export function fetchKpiDefinitions() {
  return apiRequest<KpiDefinition[]>("/kpi-definitions");
}

export function saveKpiDefinition(kpiId: string, payload: Partial<KpiDefinition>) {
  return apiRequest<KpiDefinition[]>(`/kpi-definitions/${kpiId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchEscalationRules() {
  return apiRequest<EscalationRule[]>("/escalation-rules");
}

export function saveEscalationRule(ruleId: string, payload: Partial<EscalationRule>) {
  return apiRequest<EscalationRule[]>(`/escalation-rules/${ruleId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// ============ WORKFLOW MANAGEMENT ============

export function fetchWorkflows() {
  return apiRequest<Workflow[]>("/workflows");
}

export function fetchWorkflow(workflowId: string) {
  return apiRequest<Workflow>(`/workflows/${workflowId}`);
}

export function createWorkflow(payload: Partial<Workflow>) {
  return apiRequest<Workflow>("/workflows", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWorkflow(workflowId: string, payload: Partial<Workflow>) {
  return apiRequest<Workflow>(`/workflows/${workflowId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteWorkflow(workflowId: string) {
  return apiRequest<Workflow>(`/workflows/${workflowId}`, {
    method: "DELETE",
  });
}

export function createWorkflowStage(workflowId: string, payload: Partial<WorkflowStage>) {
  return apiRequest<WorkflowStage>(`/workflows/${workflowId}/stages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWorkflowStage(
  workflowId: string,
  stageId: string,
  payload: Partial<WorkflowStage>
) {
  return apiRequest<WorkflowStage>(`/workflows/${workflowId}/stages/${stageId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteWorkflowStage(workflowId: string, stageId: string) {
  return apiRequest<WorkflowStage>(`/workflows/${workflowId}/stages/${stageId}`, {
    method: "DELETE",
  });
}

export function createWorkflowTransition(workflowId: string, payload: Partial<WorkflowTransition>) {
  return apiRequest<WorkflowTransition>(`/workflows/${workflowId}/transitions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWorkflowTransition(
  workflowId: string,
  transitionId: string,
  payload: Partial<WorkflowTransition>
) {
  return apiRequest<WorkflowTransition>(`/workflows/${workflowId}/transitions/${transitionId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteWorkflowTransition(workflowId: string, transitionId: string) {
  return apiRequest<WorkflowTransition>(`/workflows/${workflowId}/transitions/${transitionId}`, {
    method: "DELETE",
  });
}
