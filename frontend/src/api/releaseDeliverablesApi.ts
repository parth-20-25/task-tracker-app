import { apiRequest } from "@/api/http";

export type ReleaseDeliverableAction =
  | "ASSIGN"
  | "START"
  | "SUBMIT"
  | "REVIEW"
  | "SET_APPLICABILITY";

export interface ReleaseStatusSummary {
  code: string;
  label: string;
  approved?: number;
  total?: number;
}

export interface ReleaseBlocker {
  code: string;
  message: string;
  stage?: string;
  deliverable?: string;
}

export interface ReleaseDeliverableEvent {
  id?: string;
  event_type: string;
  previous_status?: string | null;
  new_status?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface FixtureReleaseDeliverable {
  id: string;
  package_id: string;
  deliverable_code: string;
  deliverable_label: string;
  sequence: number;
  is_required: boolean;
  applicability_status: "REQUIRED" | "UNRESOLVED" | "NOT_APPLICABLE";
  status: string;
  assignee_id?: string | null;
  assignee_name?: string | null;
  due_at?: string | null;
  is_overdue: boolean;
  latest_comment?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  started_at?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  is_current_actionable: boolean;
  available_actions: ReleaseDeliverableAction[];
  events: ReleaseDeliverableEvent[];
}

export interface FixtureReleasePackage {
  id: string;
  fixture_id: string;
  version: number;
  status: string;
  created_at: string;
  completed_at?: string | null;
  deliverables: FixtureReleaseDeliverable[];
}

export interface FixtureReleasePackageResponse {
  release_package: FixtureReleasePackage | null;
  statuses: {
    main_workflow: ReleaseStatusSummary;
    release_deliverables: ReleaseStatusSummary;
    release: ReleaseStatusSummary;
  };
  blockers: ReleaseBlocker[];
  available_actions: string[];
}

function fixturePath(fixtureId: string, suffix = "") {
  return "/workflows/fixtures/" + encodeURIComponent(fixtureId) + suffix;
}

export function fetchFixtureReleasePackage(fixtureId: string, departmentId?: string) {
  const params = new URLSearchParams();
  if (departmentId) {
    params.set("department_id", departmentId);
  }
  const query = params.toString();
  return apiRequest<FixtureReleasePackageResponse>(
    fixturePath(fixtureId, "/release-package") + (query ? "?" + query : ""),
  );
}

export function assignFixtureReleaseDeliverable(
  fixtureId: string,
  deliverableId: string,
  payload: { assignee_id: string; due_at?: string | null },
) {
  return apiRequest<{ release_package: FixtureReleasePackage }>(
    fixturePath(fixtureId, "/release-deliverables/" + encodeURIComponent(deliverableId) + "/assign"),
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function startFixtureReleaseDeliverable(fixtureId: string, deliverableId: string) {
  return apiRequest<{ release_package: FixtureReleasePackage }>(
    fixturePath(fixtureId, "/release-deliverables/" + encodeURIComponent(deliverableId) + "/start"),
    { method: "POST" },
  );
}

export function submitFixtureReleaseDeliverable(
  fixtureId: string,
  deliverableId: string,
  comment?: string,
) {
  return apiRequest<{ release_package: FixtureReleasePackage }>(
    fixturePath(fixtureId, "/release-deliverables/" + encodeURIComponent(deliverableId) + "/submit"),
    { method: "POST", body: JSON.stringify({ comment }) },
  );
}

export function reviewFixtureReleaseDeliverable(
  fixtureId: string,
  deliverableId: string,
  payload: { decision: "APPROVE" | "REJECT"; reason?: string },
) {
  return apiRequest<{ release_package: FixtureReleasePackage }>(
    fixturePath(fixtureId, "/release-deliverables/" + encodeURIComponent(deliverableId) + "/review"),
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function setMimicReleaseDeliverableApplicability(
  fixtureId: string,
  deliverableId: string,
  payload: { applicability: "REQUIRED" | "NOT_APPLICABLE"; reason?: string },
) {
  return apiRequest<{ release_package: FixtureReleasePackage }>(
    fixturePath(fixtureId, "/release-deliverables/" + encodeURIComponent(deliverableId) + "/applicability"),
    { method: "POST", body: JSON.stringify(payload) },
  );
}
