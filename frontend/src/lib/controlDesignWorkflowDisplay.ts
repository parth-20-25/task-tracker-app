import type {
  ControlProjectWorkflow,
  ControlWorkflowStage,
  ControlWorkflowStageStatus,
  ControlWorkflowTemplate,
  ControlWorkflowTemplateStage,
} from "@/api/controlWorkflowApi";
import type { ProjectDashboardSummary } from "@/types";

export const CONTROL_DESIGN_STAGE_NAMES = [
  "CO Creation",
  "ERP Budget Approval",
  "CO Release",
  "WBS Addition",
  "I/O List Preparation",
  "E-Plan Drawing Release",
  "Panel Material Issue",
  "Field Material Preparation",
  "Manual Preparation",
] as const;

const APPROVED_PROGRESS_STATUSES = new Set<ControlWorkflowStageStatus>(["approved", "pre_completed"]);
const TERMINAL_STAGE_STATUSES = new Set<ControlWorkflowStageStatus>([
  "approved",
  "pre_completed",
  "skipped_by_override",
]);

export interface ControlDesignDisplayStage {
  id: string;
  name: string;
  order: number;
  status: ControlWorkflowStageStatus;
  isRequired: boolean;
  revisionCount: number;
  locked: boolean;
  isCurrent: boolean;
  startedAt?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
}

export interface ControlDesignWorkflowDisplay {
  workflowAvailable: boolean;
  assignedToId: string | null;
  assignedToName: string | null;
  currentStageName: string;
  workflowStatus: string;
  dispatchStatus: string | null;
  priority: string | null;
  approvedCount: number;
  totalRequired: number;
  percent: number;
  stages: ControlDesignDisplayStage[];
}

function sortByOrder<T extends { sequence_order?: number }>(items: T[]) {
  return [...items].sort((left, right) => Number(left.sequence_order || 0) - Number(right.sequence_order || 0));
}

function fallbackStatusForIndex(index: number): ControlWorkflowStageStatus {
  return index === 0 ? "not_started" : "locked";
}

function toDisplayStage(
  stage: ControlWorkflowStage,
  currentStageId: string | null | undefined,
): ControlDesignDisplayStage {
  return {
    id: stage.id,
    name: stage.stage_name,
    order: Number(stage.sequence_order || 0),
    status: stage.status,
    isRequired: stage.is_required !== false,
    revisionCount: Number(stage.revision_count || 0),
    locked: stage.status === "locked",
    isCurrent: Boolean(currentStageId && stage.id === currentStageId),
    startedAt: stage.started_at,
    submittedAt: stage.submitted_at,
    approvedAt: stage.approved_at,
  };
}

function templateStageToDisplay(stage: ControlWorkflowTemplateStage, index: number): ControlDesignDisplayStage {
  const status = fallbackStatusForIndex(index);

  return {
    id: stage.id || `template-stage-${index + 1}`,
    name: stage.stage_name,
    order: Number(stage.sequence_order || index + 1),
    status,
    isRequired: stage.is_required !== false,
    revisionCount: 0,
    locked: status === "locked",
    isCurrent: index === 0,
    startedAt: null,
    submittedAt: null,
    approvedAt: null,
  };
}

function configuredStageToDisplay(stageName: string, index: number): ControlDesignDisplayStage {
  const status = fallbackStatusForIndex(index);

  return {
    id: `configured-stage-${index + 1}`,
    name: stageName,
    order: index + 1,
    status,
    isRequired: true,
    revisionCount: 0,
    locked: status === "locked",
    isCurrent: index === 0,
    startedAt: null,
    submittedAt: null,
    approvedAt: null,
  };
}

function firstOpenStage(stages: ControlDesignDisplayStage[]) {
  return stages.find((stage) => !TERMINAL_STAGE_STATUSES.has(stage.status)) || stages[stages.length - 1] || null;
}

function buildStages(
  workflow: ControlProjectWorkflow | null | undefined,
  template: ControlWorkflowTemplate | null | undefined,
) {
  if (workflow?.stages?.length) {
    return sortByOrder(workflow.stages).map((stage) => toDisplayStage(stage, workflow.current_stage_id));
  }

  if (template?.stages?.length) {
    return sortByOrder(template.stages).map(templateStageToDisplay);
  }

  return CONTROL_DESIGN_STAGE_NAMES.map(configuredStageToDisplay);
}

export function buildControlDesignWorkflowDisplay({
  project,
  workflow,
  template,
}: {
  project: ProjectDashboardSummary;
  workflow?: ControlProjectWorkflow | null;
  template?: ControlWorkflowTemplate | null;
}): ControlDesignWorkflowDisplay {
  const stages = buildStages(workflow, template);
  const requiredStages = stages.filter((stage) => stage.isRequired);
  const totalRequired = requiredStages.length;
  const approvedCount = requiredStages.filter((stage) => APPROVED_PROGRESS_STATUSES.has(stage.status)).length;
  const currentStage = workflow?.current_stage?.stage_name
    ? workflow.current_stage.stage_name
    : firstOpenStage(stages)?.name || "Complete";

  return {
    workflowAvailable: Boolean(workflow),
    assignedToId: workflow?.assigned_user_id || project.team_lead_id || project.project_leader_id || null,
    assignedToName: workflow?.assigned_user_name || project.team_lead_name || project.project_leader_name || null,
    currentStageName: currentStage,
    workflowStatus: workflow?.status || project.project_status || "active",
    dispatchStatus: workflow?.dispatch_status || null,
    priority: null,
    approvedCount,
    totalRequired,
    percent: totalRequired === 0 ? 0 : Math.round((approvedCount / totalRequired) * 100),
    stages,
  };
}