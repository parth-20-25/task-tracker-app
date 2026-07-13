import { apiRequest } from "@/api/http";

export type FixtureOutsourceScope = "all_assignable" | "selected";

export interface DesignVendor {
  id: string;
  name: string;
  code?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  is_active: boolean;
}

export interface FixtureOutsourceSkip {
  fixture_id: string;
  fixture_no?: string | null;
  code: string;
  message: string;
}

export interface FixtureOutsourceEvent {
  id: string;
  event_type: string;
  previous_status?: string | null;
  new_status?: string | null;
  actor_id?: string | null;
  reason?: string | null;
  created_at: string;
}

export interface FixtureOutsourceAssignment {
  id: string;
  fixture_id: string;
  fixture_no: string;
  project_id: string;
  project_code?: string | null;
  project_name?: string | null;
  workflow_stage_code: string;
  workflow_stage_name: string;
  workflow_stage_version: number;
  vendor_id: string;
  vendor_name: string;
  vendor_code?: string | null;
  internal_coordinator_id: string;
  internal_coordinator_name?: string | null;
  deadline: string;
  priority: string;
  status: string;
  instructions: string;
  expected_deliverables?: string | null;
  work_order_reference?: string | null;
  reference_path?: string | null;
  official_stage_status?: string | null;
  outsourced_at: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  events: FixtureOutsourceEvent[];
}

export interface BulkFixtureOutsourcePayload {
  project_id: string;
  workflow_stage: string;
  scope: FixtureOutsourceScope;
  fixture_ids: string[];
  vendor_id: string;
  internal_coordinator_id: string;
  deadline: string;
  priority: string;
  instructions: string;
  work_order_reference?: string;
  expected_deliverables?: string;
  reference_path?: string;
}

export interface FixtureOutsourcePreview {
  project: {
    project_id: string;
    project_code?: string | null;
    project_name?: string | null;
  };
  workflow_stage: string;
  workflow_stage_code: string;
  scope: FixtureOutsourceScope;
  requested: number;
  eligible: number;
  eligible_fixture_ids: string[];
  skipped: FixtureOutsourceSkip[];
}

export interface BulkFixtureOutsourceResult {
  requested: number;
  outsourced: number;
  assignments: FixtureOutsourceAssignment[];
  skipped: FixtureOutsourceSkip[];
}

export function fetchDesignVendors() {
  return apiRequest<DesignVendor[]>("/design/vendors");
}

export function previewBulkFixtureOutsource(payload: BulkFixtureOutsourcePayload) {
  return apiRequest<FixtureOutsourcePreview>("/design/fixtures/outsource-preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function bulkOutsourceFixtures(payload: BulkFixtureOutsourcePayload) {
  return apiRequest<BulkFixtureOutsourceResult>("/design/fixtures/outsource-bulk", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchProjectOutsourceAssignments(projectId: string) {
  return apiRequest<FixtureOutsourceAssignment[]>(
    "/design/projects/" + encodeURIComponent(projectId) + "/outsource-assignments",
  );
}
