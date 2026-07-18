import { apiRequest } from "@/api/http";
import {
  ConfirmDesignUploadPayload,
  DepartmentProject,
  DesignExcelPreviewRow,
  DesignExcelRejectedRow,
  DesignExcelUploadResponse,
  DesignFixtureOption,
  DesignProjectOption,
  OutsourceStage,
  ProjectDashboardSummary,
  Task,
  ValidateRejectedDesignRowResponse,
} from "@/types";

// ── Fixture Workflow Types ────────────────────────────────────────────────────

export type FixtureStageStatus = "PENDING" | "IN_PROGRESS" | "SUBMITTED_FOR_VERIFICATION" | "APPROVED" | "REJECTED";

export interface FixtureCurrentStage {
  stage: string | null;
  stage_label?: string | null;
  stage_version?: number;
  revision_code?: string | null;
  status: FixtureStageStatus | "APPROVED";
  stage_order: number | null;
  is_complete: boolean;
}

export interface FixtureStageContribution {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  contribution_percent: number;
  contribution_kind?: "ACTUAL" | "REMAINING";
  transfer_reason?: string | null;
  transferred_by?: string | null;
  transferred_by_name?: string | null;
  transferred_at?: string | null;
}

export interface FixtureProgressStage {
  stage_name: string;
  stage_label?: string | null;
  stage_version?: number;
  revision_code?: string | null;
  stage_order: number;
  status: FixtureStageStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  updated_at: string;
  contributions?: FixtureStageContribution[];
}

export type FixtureRevisionType =
  | "CUSTOMER_CHANGE"
  | "CUSTOMER_TRIAL_CHANGE"
  | "CUSTOMER_REVISION"
  | "INTERNAL_DESIGN_CHANGE"
  | "MANUFACTURING_ISSUE"
  | "QUALITY_CORRECTION"
  | "COST_OPTIMIZATION"
  | "APPROVAL_REJECTION"
  | "PROCUREMENT_CONSTRAINT"
  | "MANUAL_OVERRIDE"
  | "OTHER";

export interface FixtureRevisionTimelineEntry {
  id: string;
  fixture_id: string;
  department_id: string;
  revision_no: number;
  /** Display stage name (e.g. Concept) — not merged with revision */
  stage?: string | null;
  stage_name?: string | null;
  stage_version?: number;
  /** Canonical revision code (e.g. CON 02) */
  revision?: string | null;
  revision_code?: string | null;
  reason_type?: FixtureRevisionType | string | null;
  reason_type_label?: string | null;
  revision_type: FixtureRevisionType;
  revision_reason?: string | null;
  revision_remarks?: string | null;
  previous_revision?: string | null;
  approval_state?: string | null;
  reverted_from_stage: string;
  reverted_to_stage: string;
  requested_by: string;
  requested_by_name?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  changed_by: string;
  changed_by_name?: string | null;
  changed_at: string;
  metadata: Record<string, unknown>;
}

export interface FixtureFullProgress {
  workflow_name: string;
  revision_no: number;
  is_legacy_workflow: boolean;
  stages: FixtureProgressStage[];
  revisions: FixtureRevisionTimelineEntry[];
}

export interface WorkflowDefinition {
  stages: string[];
}

export interface AssignmentValidation {
  canAssign: boolean;
  reason: string | null;
  currentStage: FixtureProgressStage | null;
}


export interface DepartmentWorkflowPreview {
  id: string;
  name: string;
  first_stage_id: string;
  first_stage_name: string;
}

export interface DepartmentProjectPayload {
  project_no: string;
  project_name: string;
  customer_name: string;
  instance_count: number;
  rework_date?: string | null;
}

export interface CreateDesignTaskPayload {
  department_id?: string;
  project_id: string;
  fixture_id?: string;
  description: string;
  assigned_to: string;
  assignee_ids?: string[];
  priority: Task["priority"];
  deadline: string;
  planned_minutes?: number;
  [key: string]: unknown;
}

export interface UploadDepartmentProjectsResponse {
  success_count: number;
  skipped_rows: Array<{
    row_number: number | null;
    project_no: string;
    project_name: string;
    customer_name: string;
    instance_count: number;
    rework_date?: string | null;
    reason: string;
  }>;
}

export interface Project2DLeader {
  employee_id: string;
  name: string;
  department_id: string;
  subdivision_id: string;
  subdivision_name: string;
  role_id: string;
  role_name?: string | null;
}

export interface ProjectSubdivisionAssignment {
  id: string;
  project_id: string;
  subdivision_id: string;
  subdivision_name: string;
  assigned_leader_id: string;
  assigned_leader_name?: string | null;
  assigned_by?: string | null;
  assigned_by_name?: string | null;
  created_at: string;
  is_active: boolean;
}

export interface Project2DRouting {
  project_id: string;
  eligible_leaders: Project2DLeader[];
  assignments: ProjectSubdivisionAssignment[];
}

export interface OutsourceFixturePayload {
  supplier_name: string;
  outsourced_stages: OutsourceStage[];
  department_id?: string;
}

export interface BulkOutsourceFixtureResult {
  fixtureId: string;
  success: boolean;
  code?: string;
  message?: string;
}

export interface BulkOutsourceFixturesResponse {
  requested: number;
  succeeded: number;
  failed: number;
  results: BulkOutsourceFixtureResult[];
}

export type ProjectReactivationReason =
  | "customer_modification"
  | "internal_modification"
  | "drawing_update"
  | "fixture_correction"
  | "other";

export interface ReactivateProjectPayload {
  reason?: ProjectReactivationReason;
  comment?: string;
}

export interface ReactivateProjectResponse {
  project_id: string;
  batch_id: string | null;
  status: "active";
  previous_status: string;
  is_modified: boolean;
  project: {
    project_id: string;
    project_no: string;
    project_name: string;
    customer_name: string | null;
    department_id: string;
    project_status: "active";
    is_modified: boolean;
    completed_at: string | null;
    status_changed_at: string;
    updated_at: string;
  };
  reactivation_reason: ProjectReactivationReason;
  reactivation_reason_label: string;
  reactivation_comment: string | null;
  workflow_restoration?: Record<string, number>;
  message: string;
}

export type Design2DCompletionTaskCode =
  | "FIXTURE_DRAFTING_CHECKING"
  | "FIXTURE_DRAWING_CORRECTION"
  | "FIXTURE_AUTOCAD_PDF"
  | "FIXTURE_IGES"
  | "PROJECT_CMM_DATA"
  | "PROJECT_LINE_LAYOUT"
  | "PROJECT_MIMIC"
  | "PROJECT_WEAR_OUT_DATA";

export interface Design2DCompletionTaskDefinition {
  code: Design2DCompletionTaskCode;
  displayName: string;
  scope: "fixture" | "project";
  required: boolean;
  isMandatory?: boolean;
}

export interface Design2DCompletionCurrentActivity {
  activityKey: Design2DCompletionTaskCode;
  code: Design2DCompletionTaskCode;
  label: string;
  latestLabel: string;
  latestTask: Task | null;
  currentStatus: "UNASSIGNED" | "ASSIGNED" | "IN_PROGRESS" | "OUTSOURCED" | "VERIFICATION" | "REJECTED" | "COMPLETED" | string;
  assignable: boolean;
}

export interface Design2DCompletionActiveAssignment {
  taskId: number;
  activityKey: Design2DCompletionTaskCode;
  label: string;
  sequence: number | null;
  displaySequence: string | null;
  status: Task["status"];
  currentStatus: string;
  assignedTo: string | null;
  assigneeNames: string | null;
  supplierName: string | null;
}

export interface Design2DCompletionBlockingActivity {
  code: Design2DCompletionTaskCode;
  label: string;
  status: string;
  taskId: number | string | null;
}

export interface Design2DCompletionBlockingFixture {
  fixture_id: string;
  fixture_no: string;
  pending_activity_count: number;
  pending_activities: Design2DCompletionBlockingActivity[];
}

export interface Design2DCompletionProjectState {
  project: DesignProjectOption;
  fixtures: Array<{
    fixture_id: string;
    fixture_no: string;
    part_name: string;
    workflow_complete: boolean;
    two_d_complete: boolean;
    aggregateSection?: string;
    completedMandatoryCount?: number;
    totalMandatoryCount?: number;
    progressPercentage?: number;
    currentAssignee?: string | null;
    currentActivities?: Design2DCompletionCurrentActivity[];
    activeAssignments?: Design2DCompletionActiveAssignment[];
  }>;
  fixture_aggregates?: Array<{
    fixtureId: string;
    aggregateSection: string;
    completedMandatoryCount: number;
    totalMandatoryCount: number;
    progressPercentage: number;
    currentAssignee: string | null;
    currentActivities: Design2DCompletionCurrentActivity[];
    activeAssignments: Design2DCompletionActiveAssignment[];
  }>;
  tasks: Task[];
  fixture_task_types: Design2DCompletionTaskDefinition[];
  project_task_types: Design2DCompletionTaskDefinition[];
  all_fixtures_2d_complete: boolean;
  all_original_workflows_complete: boolean;
  eligible_fixture_count: number;
  mandatory_activity_count: number;
  approved_mandatory_activity_count: number;
  pending_mandatory_activity_count?: number;
  blocking_fixtures: Design2DCompletionBlockingFixture[];
  fixture_requirements_complete: boolean;
  project_requirements_complete?: boolean;
  project_tasks_unlocked: boolean;
  project_completion_ready: boolean;
  missing_requirements: string[];
}

export interface AssignDesign2DCompletionTaskPayload {
  department_id?: string;
  project_id: string;
  fixture_id?: string | null;
  task_code?: Design2DCompletionTaskCode;
  task_codes?: Design2DCompletionTaskCode[];
  instructions?: string;
  assigned_to: string;
  priority: Task["priority"];
  deadline: string;
  outsource?: boolean;
  supplier_name?: string;
}

function stripUndefined<T extends object>(payload: T): T {
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as T;
}

export function fetchDepartmentProjects() {
  return apiRequest<DepartmentProject[]>("/department-projects");
}

export function fetchDesignProjects(departmentId?: string, options: { activeOnly?: boolean } = {}) {
  const params = new URLSearchParams();

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  if (options.activeOnly) {
    params.set("active_only", "true");
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<DesignProjectOption[]>(`/design/projects${suffix}`);
}

export function fetchDesignFixtures(projectId: string, departmentId?: string, options: { activeOnly?: boolean } = {}) {
  const params = new URLSearchParams();
  params.set("project_id", projectId);

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  if (options.activeOnly) {
    params.set("active_only", "true");
  }

  return apiRequest<DesignFixtureOption[]>(`/design/fixtures?${params.toString()}`);
}

export function updateFixtureOutsourcing(
  fixtureId: string,
  payload: { is_outsourced: boolean; department_id?: string; vendor_name?: string; outsourced_stages?: OutsourceStage[] },
) {
  return apiRequest<DesignFixtureOption>(`/design/fixtures/${encodeURIComponent(fixtureId)}/outsourcing`, {
    method: "PATCH",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function outsourceFixture(fixtureId: string, payload: OutsourceFixturePayload) {
  return apiRequest<DesignFixtureOption>(`/design/fixtures/${encodeURIComponent(fixtureId)}/outsource`, {
    method: "POST",
    body: JSON.stringify(stripUndefined({ ...payload })),
  });
}

export function bulkOutsourceFixtures(payload: {
  projectId: string;
  fixtureIds: string[];
  outsourceData: OutsourceFixturePayload;
}) {
  return apiRequest<BulkOutsourceFixturesResponse>("/design/fixtures/outsource/bulk", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function bringFixtureInHouse(fixtureId: string, payload: { department_id?: string } = {}) {
  return apiRequest<DesignFixtureOption>(`/design/fixtures/${encodeURIComponent(fixtureId)}/bring-in-house`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function completeOutsourcedFixture(fixtureId: string, payload: { department_id?: string } = {}) {
  return apiRequest<DesignFixtureOption & { workflow_marked_complete?: boolean }>(
    `/design/fixtures/${encodeURIComponent(fixtureId)}/outsource-complete`,
    {
      method: "POST",
      body: JSON.stringify(stripUndefined(payload)),
    },
  );
}

export function fetchProjectOutsourcedFixtures(projectId: string, departmentId?: string) {
  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<DesignFixtureOption[]>(
    `/design/projects/${encodeURIComponent(projectId)}/outsourced-fixtures${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

export function fetchRecentOutsourceSuppliers(departmentId?: string) {
  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<string[]>(`/design/outsourcing/suppliers${params.toString() ? `?${params.toString()}` : ""}`);
}

export function fetchProject2DRouting(projectId: string) {
  return apiRequest<Project2DRouting>(`/design/projects/${encodeURIComponent(projectId)}/2d-routing`);
}

export function assignProjectTo2D(projectId: string, assignedLeaderId: string) {
  return apiRequest<ProjectSubdivisionAssignment>(`/design/projects/${encodeURIComponent(projectId)}/2d-routing`, {
    method: "POST",
    body: JSON.stringify({ assigned_leader_id: assignedLeaderId }),
  });
}

export function deleteProject2DAssignment(projectId: string, assignmentId: string) {
  return apiRequest<Project2DRouting>(
    `/design/projects/${encodeURIComponent(projectId)}/2d-routing/${encodeURIComponent(assignmentId)}`,
    { method: "DELETE" },
  );
}

export function updateProjectModification(projectId: string, isModified: boolean) {
  return apiRequest<DesignProjectOption>(`/design/projects/${encodeURIComponent(projectId)}/modification`, {
    method: "PATCH",
    body: JSON.stringify({ is_modified: isModified }),
  });
}

export function reactivateProject(projectId: string, payload: ReactivateProjectPayload = {}) {
  return apiRequest<ReactivateProjectResponse>(`/design/projects/${encodeURIComponent(projectId)}/reactivate`, {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function fetchProjectDashboardSummary(departmentId?: string) {
  const params = new URLSearchParams();

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<ProjectDashboardSummary[]>(`/projects/summary${params.toString() ? `?${params.toString()}` : ""}`);
}

export function fetchDesign2DCompletionProjects(departmentId?: string) {
  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<DesignProjectOption[]>(`/design/2d-completion-tasks/projects${suffix}`);
}

export function fetchDesign2DCompletionProjectState(projectId: string, departmentId?: string) {
  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<Design2DCompletionProjectState>(
    `/design/2d-completion-tasks/projects/${encodeURIComponent(projectId)}${suffix}`,
  );
}

export function assignDesign2DCompletionTask(payload: AssignDesign2DCompletionTaskPayload) {
  return apiRequest<Task>("/design/2d-completion-tasks", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function assignDesign2DCompletionTasks(payload: AssignDesign2DCompletionTaskPayload) {
  return apiRequest<Task[]>("/design/2d-completion-tasks", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function markDesign2DMimicNotRequired(payload: {
  project_id: string;
  department_id?: string;
  reason: string;
}) {
  return apiRequest<Task>("/design/2d-completion-tasks/mimic-not-required", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function fetchDepartmentWorkflowPreview(projectId?: string) {
  const url = projectId ? `/design/workflow-preview?project_id=${encodeURIComponent(projectId)}` : "/design/workflow-preview";
  return apiRequest<DepartmentWorkflowPreview>(url);
}

export function uploadDepartmentProject(payload: DepartmentProjectPayload) {
  return apiRequest<UploadDepartmentProjectsResponse>("/department-projects", {
    method: "POST",
    body: JSON.stringify({ rows: [payload] }),
  });
}

export function uploadDepartmentProjects(payload: DepartmentProjectPayload[]) {
  return apiRequest<UploadDepartmentProjectsResponse>("/department-projects", {
    method: "POST",
    body: JSON.stringify({ rows: payload }),
  });
}

export function createDesignTask(payload: CreateDesignTaskPayload) {
  return apiRequest<Task>("/design/tasks", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function releaseFixtureWorkflow(payload: { fixture_id: string; department_id?: string }) {
  return apiRequest<FixtureCurrentStage>("/workflows/release", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function uploadDesignExcel(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return apiRequest<DesignExcelUploadResponse>("/upload/design-excel", {
    method: "POST",
    body: formData,
  });
}

export function uploadNativeDesignExcel(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return apiRequest<DesignExcelUploadResponse>("/upload/design-native-excel", {
    method: "POST",
    body: formData,
  });
}

export function confirmDesignUpload(payload: ConfirmDesignUploadPayload) {
  return apiRequest<{ success: boolean; batch_id: string; accepted_count: number }>("/upload/design-excel/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function confirmNativeDesignUpload(payload: ConfirmDesignUploadPayload) {
  return apiRequest<{ success: boolean; batch_id: string; accepted_count: number }>("/upload/design-native-excel/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function pastePasteFixtureData(text: string) {
  return apiRequest<DesignExcelUploadResponse>("/design/upload", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function pasteNativeFixtureData(text: string) {
  return apiRequest<DesignExcelUploadResponse>("/design/native-upload", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function confirmPasteFixtureData(payload: ConfirmDesignUploadPayload) {
  return apiRequest<{ success: boolean; batch_id: string; accepted_count: number }>("/design/upload/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function confirmNativePasteFixtureData(payload: ConfirmDesignUploadPayload) {
  return apiRequest<{ success: boolean; batch_id: string; accepted_count: number }>("/design/native-upload/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function validateRejectedDesignRow(payload: {
  file_info: DesignExcelUploadResponse["file_info"];
  original_row: DesignExcelRejectedRow;
  corrected_row: Record<string, unknown>;
  reserved_fixture_numbers: string[];
}) {
  return apiRequest<ValidateRejectedDesignRowResponse>("/design/upload/rejected-row/validate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function validateNativeRejectedDesignRow(payload: {
  file_info: DesignExcelUploadResponse["file_info"];
  original_row: DesignExcelRejectedRow;
  corrected_row: Record<string, unknown>;
  reserved_fixture_numbers: string[];
}) {
  return apiRequest<ValidateRejectedDesignRowResponse>("/design/native-upload/rejected-row/validate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listFixturesByUploadBatch(batchId: string, departmentId?: string) {
  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }
  
  return apiRequest<Array<{
    fixture_id: string;
    fixture_no: string;
    image_1_url: string | null;
    image_2_url: string | null;
    ingestion_source: string | null;
  }>>(`/design/upload-batches/${encodeURIComponent(batchId)}/fixtures${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
  });
}

export function listNativeFixturesByUploadBatch(batchId: string, departmentId?: string) {
  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<Array<{
    fixture_id: string;
    fixture_no: string;
    image_1_url: string | null;
    image_2_url: string | null;
    ingestion_source: string | null;
  }>>(`/design/native-upload-batches/${encodeURIComponent(batchId)}/fixtures${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "GET",
  });
}

export function uploadFixtureReferenceImage(
  fixtureId: string,
  imageType: "part" | "fixture",
  file: File,
  departmentId?: string,
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("image_type", imageType);

  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<{
    fixture_no: string;
    previous_image_url: string | null;
    new_image_url: string;
  }>(`/design/native/fixtures/${encodeURIComponent(fixtureId)}/reference-image${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "POST",
    body: formData,
  });
}

export function uploadNativeFixtureReferenceImage(
  fixtureId: string,
  imageType: "part" | "fixture",
  file: File,
  departmentId?: string,
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("image_type", imageType);

  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<{
    fixture_no: string;
    previous_image_url: string | null;
    new_image_url: string;
  }>(`/design/native/fixtures/${encodeURIComponent(fixtureId)}/reference-image${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "POST",
    body: formData,
  });
}

// ── Fixture Workflow Engine API ───────────────────────────────────────────────

export function fetchWorkflowByDepartment() {
  return apiRequest<WorkflowDefinition>("/workflows/by-department");
}

export function fetchFixtureCurrentStage(fixtureId: string, departmentId?: string) {
  const params = new URLSearchParams();
  params.set("fixture_id", fixtureId);

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<FixtureCurrentStage | null>(`/workflows/current-stage?${params.toString()}`);
}

export function fetchFixtureFullProgress(fixtureId: string, departmentId?: string) {
  const params = new URLSearchParams();
  params.set("fixture_id", fixtureId);

  if (departmentId) {
    params.set("department_id", departmentId);
  }

  return apiRequest<FixtureFullProgress>(`/workflows/progress?${params.toString()}`);
}

export function validateFixtureAssignment(fixtureId: string, departmentId?: string) {
  return apiRequest<AssignmentValidation>("/workflows/validate-assignment", {
    method: "POST",
    body: JSON.stringify(stripUndefined({ fixture_id: fixtureId, department_id: departmentId })),
  });
}

export function assignFixtureStage(payload: { fixture_id: string; assigned_to: string; department_id?: string }) {
  return apiRequest<FixtureCurrentStage>("/workflows/assign", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function completeFixtureStage(payload: { fixture_id: string; department_id?: string }) {
  return apiRequest<FixtureCurrentStage>("/workflows/complete", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function approveFixtureStage(payload: { fixture_id: string; department_id?: string }) {
  return apiRequest<FixtureCurrentStage>("/workflows/approve", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function rejectFixtureStage(payload: { fixture_id: string; department_id?: string }) {
  return apiRequest<FixtureCurrentStage>("/workflows/reject", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function reopenFixtureStage(payload: {
  fixture_id: string;
  department_id?: string;
  target_stage_name?: string;
  target_stage_order?: number;
  revision_type: FixtureRevisionType;
  revision_reason?: string;
  remarks?: string;
}) {
  return apiRequest<FixtureFullProgress>("/workflows/reopen-stage", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}

export function manipulateFixtureStage(payload: {
  fixture_id: string;
  department_id?: string;
  target_stage_name?: string;
  target_stage_order?: number;
  target_status?: FixtureStageStatus;
  reason_type?: FixtureRevisionType | string;
  revision_type?: FixtureRevisionType | string;
  revision_reason?: string;
  remarks?: string;
}) {
  return apiRequest<FixtureFullProgress>("/workflows/manual-stage", {
    method: "POST",
    body: JSON.stringify(stripUndefined(payload)),
  });
}
