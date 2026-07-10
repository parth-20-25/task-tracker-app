import { describe, expect, it } from "vitest";
import type { ControlProjectWorkflow, ControlWorkflowStage, ControlWorkflowTemplate } from "@/api/controlWorkflowApi";
import type { ProjectDashboardSummary } from "@/types";
import { buildControlDesignWorkflowDisplay, CONTROL_DESIGN_STAGE_NAMES } from "@/lib/controlDesignWorkflowDisplay";

const project = {
  project_id: "project-1",
  project_no: "PARC-104",
  project_name: "ABC Automation",
  customer_name: "Robotic Welding Line",
  department_id: "control",
  department_name: "Control",
  project_status: "active",
  completion_percent: 0,
  total_fixtures: 0,
  total_tasks: 0,
  pending_tasks: 0,
  active_tasks: 0,
  completed_tasks: 0,
  team_lead_id: "EMP-LEAD",
  team_lead_name: "Lead User",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
} as ProjectDashboardSummary;

function stage(overrides: Partial<ControlWorkflowStage>): ControlWorkflowStage {
  return {
    id: overrides.id || "stage-1",
    workflow_id: "workflow-1",
    template_stage_id: null,
    stage_name: overrides.stage_name || "CO Creation",
    sequence_order: overrides.sequence_order || 1,
    is_required: overrides.is_required ?? true,
    status: overrides.status || "locked",
    current_document_path: null,
    started_at: null,
    submitted_at: null,
    approved_at: null,
    approved_by: null,
    approved_by_name: null,
    due_date: null,
    remarks: null,
    revision_count: overrides.revision_count || 0,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    submissions: [],
    revisions: [],
    document_history: [],
    override_history: [],
    ...overrides,
  };
}

function workflow(stages: ControlWorkflowStage[]): ControlProjectWorkflow {
  return {
    id: "workflow-1",
    project_id: "project-1",
    project_no: "PARC-104",
    project_name: "ABC Automation",
    customer_name: "Robotic Welding Line",
    project_status: "active",
    dispatch_status: "Not Dispatched",
    department_id: "control",
    department_name: "Control",
    sub_department_id: "sub-control-design",
    sub_department_name: "Control Design",
    template_id: "template-control-design",
    template_name: "Control Design",
    assigned_user_id: "EMP-OWNER",
    assigned_user_name: "Owner User",
    assigned_by: "EMP-LEAD",
    assigned_by_name: "Lead User",
    current_stage_id: "stage-6",
    status: "active",
    started_at: "2026-07-01T00:00:00.000Z",
    completed_at: null,
    stages,
    progress: {
      approved_or_pre_completed_stages: 0,
      skipped_by_override_stages: 0,
      total_required_stages: stages.length,
      percent: 0,
    },
    current_stage: stages.find((item) => item.id === "stage-6") || null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

describe("buildControlDesignWorkflowDisplay", () => {
  it("adapts a real workflow into sorted lifecycle display data", () => {
    const stages = [
      stage({ id: "stage-6", stage_name: "E-Plan Drawing Release", sequence_order: 6, status: "in_progress" }),
      stage({ id: "stage-1", stage_name: "CO Creation", sequence_order: 1, status: "approved" }),
      stage({ id: "stage-2", stage_name: "ERP Budget Approval", sequence_order: 2, status: "pre_completed" }),
      stage({ id: "stage-3", stage_name: "CO Release", sequence_order: 3, status: "skipped_by_override" }),
      stage({ id: "stage-4", stage_name: "WBS Addition", sequence_order: 4, status: "approved" }),
      stage({ id: "stage-5", stage_name: "I/O List Preparation", sequence_order: 5, status: "approved", revision_count: 1 }),
    ];

    const display = buildControlDesignWorkflowDisplay({ project, workflow: workflow(stages) });

    expect(display.workflowAvailable).toBe(true);
    expect(display.assignedToId).toBe("EMP-OWNER");
    expect(display.currentStageName).toBe("E-Plan Drawing Release");
    expect(display.dispatchStatus).toBe("Not Dispatched");
    expect(display.approvedCount).toBe(4);
    expect(display.totalRequired).toBe(6);
    expect(display.percent).toBe(67);
    expect(display.stages.map((item) => item.name)).toEqual([
      "CO Creation",
      "ERP Budget Approval",
      "CO Release",
      "WBS Addition",
      "I/O List Preparation",
      "E-Plan Drawing Release",
    ]);
    expect(display.stages[4].revisionCount).toBe(1);
    expect(display.stages[5].isCurrent).toBe(true);
  });

  it("uses template stages when a project workflow has not been created", () => {
    const template = {
      id: "template-control-design",
      department_id: "control",
      department_name: "Control",
      sub_department_id: "sub-control-design",
      sub_department_name: "Control Design",
      name: "Control Design",
      template_name: "Control Design",
      is_active: true,
      stages: CONTROL_DESIGN_STAGE_NAMES.map((stageName, index) => ({
        id: `template-stage-${index + 1}`,
        template_id: "template-control-design",
        stage_name: stageName,
        sequence_order: index + 1,
        is_required: true,
      })),
    } as ControlWorkflowTemplate;

    const display = buildControlDesignWorkflowDisplay({ project, workflow: null, template });

    expect(display.workflowAvailable).toBe(false);
    expect(display.assignedToId).toBe("EMP-LEAD");
    expect(display.currentStageName).toBe("CO Creation");
    expect(display.approvedCount).toBe(0);
    expect(display.totalRequired).toBe(9);
    expect(display.stages[0]).toMatchObject({ name: "CO Creation", status: "not_started", isCurrent: true });
    expect(display.stages.slice(1).every((item) => item.status === "locked")).toBe(true);
  });
});