import type { Task } from "@/types";

export const THREE_D_PROJECT_PROOF_OPTIONAL_KINDS = [
  "Project Process",
  "Pin Matrix",
  "PPT",
  "CBO",
  "Line Layout",
  "CDRM",
] as const;

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function isDapTask(task: Partial<Task>) {
  const normalized = normalize(task.workflow_stage)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized === "dap" || normalized === "d_a_p";
}

export function isProofOptionalThreeDProjectAdditionalTask(task: Partial<Task>) {
  return task.task_type === "additional_design"
    && task.design_team === "3D"
    && task.scope_type === "project"
    && !task.fixture_id
    && THREE_D_PROJECT_PROOF_OPTIONAL_KINDS.includes(task.additional_task_kind as typeof THREE_D_PROJECT_PROOF_OPTIONAL_KINDS[number]);
}

export function hasTaskWorkProof(task: Partial<Task>) {
  return Boolean((task.proof_url ?? []).some(Boolean) || task.latest_proof?.file_url);
}

export function requiresTaskWorkProof(task: Partial<Task>) {
  if (task.proof_required === false) {
    return false;
  }

  if (task.task_type === "design_2d_completion" || isDapTask(task)) {
    return false;
  }

  return !isProofOptionalThreeDProjectAdditionalTask(task);
}
