import type { DesignFixtureOption, OutsourceStage } from "@/types";

export function compactWorkflowCode(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.replace(/\s+/g, "") : null;
}

export function normalizeStageKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getFixtureWorkflowCode(fixture: DesignFixtureOption) {
  return compactWorkflowCode(fixture.workflow_revision_code);
}

export function getCurrentFixtureStageLabel(fixture: DesignFixtureOption) {
  if (fixture.is_workflow_complete === true) {
    return "Release";
  }

  return fixture.workflow_stage_label || fixture.workflow_stage || "Pending";
}

export function getFixtureCurrentRevisionLabel(fixture: DesignFixtureOption) {
  return getFixtureWorkflowCode(fixture) || getCurrentFixtureStageLabel(fixture);
}

export function getFixtureOutsourceStatus(fixture: DesignFixtureOption) {
  return fixture.outsource_status || (fixture.is_outsourced === true ? "outsourced" : null);
}

export function canonicalOutsourceStageFromWorkflowStage(value: string | null | undefined): OutsourceStage | null {
  const normalized = normalizeStageKey(value);
  if (normalized === "concept" || normalized === "concept_stage") {
    return "Concept";
  }
  if (normalized === "3d" || normalized === "3d_finish" || normalized === "three_d" || normalized === "three_d_finish") {
    return "3D";
  }
  if (normalized === "2d" || normalized === "2d_finish" || normalized === "two_d" || normalized === "two_d_finish") {
    return "2D";
  }
  return null;
}

type OrderedWorkflowStage = OutsourceStage | "DAP";

const WORKFLOW_STAGE_ORDER: OrderedWorkflowStage[] = ["Concept", "DAP", "3D", "2D"];

function canonicalOrderedWorkflowStage(value: string | null | undefined): OrderedWorkflowStage | null {
  const normalized = normalizeStageKey(value);
  if (normalized === "dap" || normalized === "d_a_p") {
    return "DAP";
  }
  return canonicalOutsourceStageFromWorkflowStage(value);
}

function getCurrentOutsourceStageIndex(fixture: DesignFixtureOption) {
  const currentStage = canonicalOrderedWorkflowStage(getCurrentFixtureStageLabel(fixture));
  return currentStage ? WORKFLOW_STAGE_ORDER.indexOf(currentStage) : -1;
}

export function isFixtureOutsourcePlanActive(fixture: DesignFixtureOption) {
  return getFixtureOutsourceStatus(fixture) === "outsourced";
}

export function hasFixtureOutsourcePlan(fixture: DesignFixtureOption) {
  const status = getFixtureOutsourceStatus(fixture);
  return fixture.is_outsourced === true
    && status !== "brought_in_house"
    && (fixture.outsourced_stages || []).length > 0;
}

export function isFixtureCurrentStageOutsourced(fixture: DesignFixtureOption) {
  if (fixture.is_workflow_complete === true || !hasFixtureOutsourcePlan(fixture)) {
    return false;
  }

  const currentStage = canonicalOutsourceStageFromWorkflowStage(getCurrentFixtureStageLabel(fixture));
  return Boolean(currentStage && fixture.outsourced_stages?.includes(currentStage));
}

export function isFixtureNextOutsourcedStagePending(fixture: DesignFixtureOption) {
  if (fixture.is_workflow_complete === true || !hasFixtureOutsourcePlan(fixture)) {
    return false;
  }

  const currentIndex = getCurrentOutsourceStageIndex(fixture);
  if (currentIndex < 0) {
    return false;
  }

  const nextStage = WORKFLOW_STAGE_ORDER[currentIndex + 1] || null;
  return Boolean(nextStage && fixture.outsourced_stages?.includes(nextStage));
}

export function isFixtureActiveOutsourcedSection(fixture: DesignFixtureOption) {
  return isFixtureCurrentStageOutsourced(fixture) || isFixtureNextOutsourcedStagePending(fixture);
}
