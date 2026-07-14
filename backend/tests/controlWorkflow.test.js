const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  CONTROL_DESIGN_STAGES,
  CONTROL_SUB_DEPARTMENTS,
  REVISION_REASONS,
  REVISION_STATUSES,
  STAGE_STATUSES,
  SUBMISSION_STATUSES,
  assertOtherReasonHasManualRemarks,
  calculateWorkflowProgress,
  canStartStage,
  canSubmitStage,
  createInitialStageRows,
  hasOpenRevision,
  hasPendingSubmission,
  isApprovedForProgress,
  isControlDepartmentUser,
  isControlDesignSubdivisionUser,
  isControlDesignWorkspaceUser,
  isControlDesignLifecycleComplete,
  isReadyForDispatch,
  isTerminalStageStatus,
  nextUnlockedStage,
  normalizeControlKey,
  normalizeRevisionReason,
} = require("../lib/controlWorkflow");
const { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } = require("../config/constants");
const {
  canCreateControlDesignProject,
  normalizeBudgetAmount,
  normalizeControlDesignProjectPayload,
  requireControlDesignCreatePermission,
} = require("../services/controlWorkflowService");
const { findWorkflowStage, insertProjectWorkflow, insertWorkflowEvent } = require("../repositories/controlWorkflowRepository");

function templateStages() {
  return CONTROL_DESIGN_STAGES.map((stageName, index) => ({
    id: `template-stage-${index + 1}`,
    stage_name: stageName,
    sequence_order: index + 1,
    is_required: true,
  }));
}

test("control department seed data includes Control Design and the configured stage order", () => {
  assert.deepEqual(CONTROL_SUB_DEPARTMENTS, [
    "Elec. Purchase",
    "Control Design",
    "PLC Programming",
    "Robo Programming",
    "Elec. Installation",
  ]);

  assert.deepEqual(CONTROL_DESIGN_STAGES, [
    "CO Creation",
    "ERP Budget Approval",
    "CO Release",
    "WBS Addition",
    "I/O List Preparation",
    "E-Plan Drawing Release",
    "Panel Material Issue",
    "Field Material Preparation",
    "Manual Preparation",
  ]);

  assert.equal(normalizeControlKey("E-Plan Drawing Release"), "e_plan_drawing_release");
});

test("new project workflow instances unlock only the first stage", () => {
  const rows = createInitialStageRows(templateStages());

  assert.equal(rows.length, 9);
  assert.equal(rows[0].stage_name, "CO Creation");
  assert.equal(rows[0].status, STAGE_STATUSES.NOT_STARTED);
  assert.equal(rows[1].status, STAGE_STATUSES.LOCKED);
  assert.equal(rows[8].stage_name, "Manual Preparation");
  assert.equal(rows[8].status, STAGE_STATUSES.LOCKED);
});

test("stage action helpers enforce sequential start and submit states", () => {
  assert.equal(canStartStage({ status: STAGE_STATUSES.NOT_STARTED }), true);
  assert.equal(canStartStage({ status: STAGE_STATUSES.REVISION_REQUIRED }), true);
  assert.equal(canStartStage({ status: STAGE_STATUSES.LOCKED }), false);
  assert.equal(canStartStage({ status: STAGE_STATUSES.SUBMITTED_FOR_APPROVAL }), false);

  assert.equal(canSubmitStage({ status: STAGE_STATUSES.IN_PROGRESS }), true);
  assert.equal(canSubmitStage({ status: STAGE_STATUSES.REVISION_REQUIRED }), true);
  assert.equal(canSubmitStage({ status: STAGE_STATUSES.NOT_STARTED }), false);
  assert.equal(canSubmitStage({ status: STAGE_STATUSES.APPROVED }), false);
});

test("workflow progress counts approved and pre-completed but not override-skipped stages", () => {
  const rows = createInitialStageRows(templateStages());
  rows[0].status = STAGE_STATUSES.APPROVED;
  rows[1].status = STAGE_STATUSES.PRE_COMPLETED;
  rows[2].status = STAGE_STATUSES.SKIPPED_BY_OVERRIDE;
  rows[3].status = STAGE_STATUSES.LOCKED;

  assert.equal(isApprovedForProgress(STAGE_STATUSES.PRE_COMPLETED), true);
  assert.equal(isApprovedForProgress(STAGE_STATUSES.SKIPPED_BY_OVERRIDE), false);
  assert.equal(isTerminalStageStatus(STAGE_STATUSES.SKIPPED_BY_OVERRIDE), true);
  assert.equal(nextUnlockedStage(rows).stage_name, "WBS Addition");

  assert.deepEqual(calculateWorkflowProgress(rows), {
    approved_or_pre_completed_stages: 2,
    skipped_by_override_stages: 1,
    total_required_stages: 9,
    percent: 22,
  });
});

test("ready for dispatch requires terminal stages with no pending submissions or open revisions", () => {
  const rows = createInitialStageRows(templateStages());
  rows.forEach((row) => { row.status = STAGE_STATUSES.APPROVED; });
  rows[2].status = STAGE_STATUSES.PRE_COMPLETED;
  rows[4].status = STAGE_STATUSES.SKIPPED_BY_OVERRIDE;

  assert.equal(isReadyForDispatch(rows), true);

  rows[0].submissions = [{ status: SUBMISSION_STATUSES.PENDING }];
  assert.equal(hasPendingSubmission(rows), true);
  assert.equal(isReadyForDispatch(rows), false);

  rows[0].submissions = [];
  rows[1].revisions = [{ status: REVISION_STATUSES.CHANGES_REQUIRED }];
  assert.equal(hasOpenRevision(rows), true);
  assert.equal(isReadyForDispatch(rows), false);

  rows[1].revisions = [{ status: REVISION_STATUSES.APPROVED }];
  rows[3].status = STAGE_STATUSES.BLOCKED;
  assert.equal(isReadyForDispatch(rows), false);
});

test("revision changes-required is a canonical open revision status", () => {
  assert.equal(REVISION_STATUSES.CHANGES_REQUIRED, "changes_required");
  assert.equal(hasOpenRevision([{ revisions: [{ status: REVISION_STATUSES.CHANGES_REQUIRED }] }]), true);
});

test("revision reasons are constrained and Other requires manual remarks", () => {
  assert.equal(REVISION_REASONS.includes("Other"), true);
  assert.equal(normalizeRevisionReason("customer change"), "Customer Change");
  assert.equal(normalizeRevisionReason("unsupported reason"), null);

  assert.doesNotThrow(() => assertOtherReasonHasManualRemarks("Other", "legacy customer note"));
  assert.throws(
    () => assertOtherReasonHasManualRemarks("Other", ""),
    /manual_reason is required/,
  );
});
test("Control Design workspace access requires actual Control department and Control Design subdivision", () => {
  const controlDesignUser = {
    employee_id: "EMP-CD-1",
    name: "Control Designer",
    department_id: "control",
    department: { id: "control", name: "Control" },
    subdivision_id: "sub-control-design",
    subdivision: { id: "sub-control-design", department_id: "control", subdivision_name: "Control Design" },
    role: { id: "team_leader", name: "Team Leader" },
    permissions: ["can_assign_tasks"],
  };

  assert.equal(isControlDepartmentUser(controlDesignUser), true);
  assert.equal(isControlDesignSubdivisionUser(controlDesignUser), true);
  assert.equal(isControlDesignWorkspaceUser(controlDesignUser, "sub-control-design"), true);

  assert.equal(isControlDesignWorkspaceUser({
    ...controlDesignUser,
    department_id: "design",
    department: { id: "design", name: "Design" },
  }, "sub-control-design"), false);

  assert.equal(isControlDesignWorkspaceUser({
    ...controlDesignUser,
    subdivision_id: "sub-plc",
    subdivision: { id: "sub-plc", department_id: "control", subdivision_name: "PLC Programming" },
  }, "sub-control-design"), false);

  assert.equal(isControlDesignWorkspaceUser({
    ...controlDesignUser,
    subdivision_id: null,
    subdivision: null,
  }, "sub-control-design"), false);
});

test("Control Design workspace access is not inferred from user or role names", () => {
  assert.equal(isControlDepartmentUser({ name: "Control" }), false);
  assert.equal(isControlDesignWorkspaceUser({
    employee_id: "EMP-TL",
    name: "Control Design",
    department_id: "control",
    department: { id: "control", name: "Control" },
    role: { id: "team_leader", name: "Control Design Team Leader" },
    permissions: ["can_assign_tasks", "change_fixture_stage"],
  }), false);
});
test("Control Design project creation requires scoped create permission", () => {
  const subDepartmentId = "sub-control-design";
  const controlDesignLeader = {
    employee_id: "EMP-CD-TL",
    name: "Control Design Team Leader",
    department_id: "control",
    department: { id: "control", name: "Control" },
    subdivision_id: subDepartmentId,
    subdivision: { id: subDepartmentId, department_id: "control", subdivision_name: "Control Design" },
    role: { id: "r4", name: "Team Leader", permissions: {} },
    permissions: [PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW, PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE],
  };

  assert.equal(canCreateControlDesignProject(controlDesignLeader, subDepartmentId), true);
  assert.doesNotThrow(() => requireControlDesignCreatePermission(controlDesignLeader, subDepartmentId));

  const regularControlDesignUser = {
    ...controlDesignLeader,
    employee_id: "EMP-CD-1",
    role: { id: "r6", name: "Engineer", permissions: {} },
    permissions: [PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW, PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ASSIGNED],
  };
  assert.equal(canCreateControlDesignProject(regularControlDesignUser, subDepartmentId), false);
  assert.throws(
    () => requireControlDesignCreatePermission(regularControlDesignUser, subDepartmentId),
    (error) => error.statusCode === 403 && /creation permission/.test(error.message),
  );

  const designTeamLeader = {
    ...controlDesignLeader,
    employee_id: "EMP-DESIGN-TL",
    department_id: "design",
    department: { id: "design", name: "Design" },
  };
  assert.equal(canCreateControlDesignProject(designTeamLeader, subDepartmentId), false);
  assert.throws(
    () => requireControlDesignCreatePermission(designTeamLeader, subDepartmentId),
    (error) => error.statusCode === 403 && /Control Design workspace access/.test(error.message),
  );

  const otherControlSubdivisionLeader = {
    ...controlDesignLeader,
    employee_id: "EMP-PLC-TL",
    subdivision_id: "sub-plc",
    subdivision: { id: "sub-plc", department_id: "control", subdivision_name: "PLC Programming" },
  };
  assert.equal(canCreateControlDesignProject(otherControlSubdivisionLeader, subDepartmentId), false);
  assert.throws(
    () => requireControlDesignCreatePermission(otherControlSubdivisionLeader, subDepartmentId),
    (error) => error.statusCode === 403 && /Control Design workspace access/.test(error.message),
  );
});

test("Control Design permissions are seeded through role-id bundles", () => {
  const hasPermission = (roleId, permissionId) => ROLE_DEFAULT_PERMISSIONS[roleId].includes(permissionId);

  for (const roleId of ["r1", "r2", "r3", "r4"]) {
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ALL), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_APPROVALS_APPROVE), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_REVISIONS_RAISE), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_PROJECTS_MARK_DISPATCHED), true);
  }

  assert.equal(hasPermission("r5", PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW), true);
  assert.equal(hasPermission("r5", PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ALL), true);
  assert.equal(hasPermission("r5", PERMISSIONS.CONTROL_DESIGN_APPROVALS_REVIEW), true);
  assert.equal(hasPermission("r5", PERMISSIONS.CONTROL_DESIGN_APPROVALS_APPROVE), true);
  assert.equal(hasPermission("r5", PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE), false);
  assert.equal(hasPermission("r5", PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN), false);
  assert.equal(hasPermission("r5", PERMISSIONS.CONTROL_DESIGN_REVISIONS_RAISE), false);

  for (const roleId of ["r6", "r7"]) {
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ASSIGNED), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_STAGES_START), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_STAGES_SUBMIT), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_PATHS_UPDATE), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_REVISIONS_EXECUTE), true);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE), false);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN), false);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_APPROVALS_APPROVE), false);
    assert.equal(hasPermission(roleId, PERMISSIONS.CONTROL_DESIGN_REVISIONS_RAISE), false);
  }
});

test("frontend and backend declare the same canonical Control Design permissions", () => {
  const frontendPermissions = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/lib/permissions.ts"),
    "utf8",
  );
  const canonicalPermissions = [
    PERMISSIONS.CONTROL_DESIGN_WORKSPACE_VIEW,
    PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ASSIGNED,
    PERMISSIONS.CONTROL_DESIGN_PROJECTS_VIEW_ALL,
    PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE,
    PERMISSIONS.CONTROL_DESIGN_PROJECTS_ASSIGN,
    PERMISSIONS.CONTROL_DESIGN_PROJECTS_REASSIGN,
    PERMISSIONS.CONTROL_DESIGN_APPROVALS_APPROVE,
    PERMISSIONS.CONTROL_DESIGN_APPROVALS_REQUEST_CHANGES,
    PERMISSIONS.CONTROL_DESIGN_REVISIONS_RAISE,
    PERMISSIONS.CONTROL_DESIGN_REVISIONS_EXECUTE,
    PERMISSIONS.CONTROL_DESIGN_REVISIONS_REVIEW,
    PERMISSIONS.CONTROL_DESIGN_STAGES_OVERRIDE_UNLOCK,
    PERMISSIONS.CONTROL_DESIGN_PROJECTS_MARK_DISPATCHED,
  ];

  assert.equal(PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE, "control_design.projects.create");
  assert.equal(PERMISSIONS.CONTROL_DESIGN_CREATE_PROJECTS, PERMISSIONS.CONTROL_DESIGN_PROJECTS_CREATE);

  for (const permissionId of canonicalPermissions) {
    assert.match(frontendPermissions, new RegExp(permissionId.replace(/\./g, "\\.")));
  }
  assert.match(frontendPermissions, /"control_design\.create_projects": PERMISSIONS\.CONTROL_DESIGN_PROJECTS_CREATE/);
});

test("project workflow insert supports initially unassigned Control Design projects", async () => {
  let capturedSql = "";
  let capturedParams = [];
  const client = {
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [{ id: "workflow-1" }] };
    },
  };

  const workflowId = await insertProjectWorkflow({
    project_id: "project-1",
    department_id: "control",
    sub_department_id: "sub-control-design",
    template_id: "template-1",
    assigned_user_id: null,
    assigned_by: null,
  }, client);

  assert.equal(workflowId, "workflow-1");
  assert.equal(capturedParams[4], null);
  assert.match(capturedSql, /CASE WHEN \$5::varchar IS NULL THEN NULL ELSE NOW\(\) END/);
});
test("Control Design project creation validation trims required fields and normalizes INR budget", () => {
  assert.deepEqual(normalizeControlDesignProjectPayload({
    projectId: " PARC2600M029 ",
    projectName: " U546 Frame Auto Revising SPM ",
    customer: " Tata Motors ",
    budget: "001250000.5",
    assignedUserId: " E0042 ",
  }), {
    project_no: "PARC2600M029",
    project_name: "U546 Frame Auto Revising SPM",
    customer_name: "Tata Motors",
    budget_amount: "1250000.50",
    assigned_user_id: "E0042",
  });

  assert.equal(normalizeBudgetAmount("0"), "0.00");
  assert.equal(normalizeBudgetAmount("12.34"), "12.34");

  assert.throws(() => normalizeControlDesignProjectPayload({ projectId: " ", projectName: "Name", customer: "Customer", budget: "1" }), /Project ID is required/);
  assert.throws(() => normalizeControlDesignProjectPayload({ projectId: "P1", projectName: " ", customer: "Customer", budget: "1" }), /Project Name is required/);
  assert.throws(() => normalizeControlDesignProjectPayload({ projectId: "P1", projectName: "Name", customer: " ", budget: "1" }), /Customer is required/);
  assert.throws(() => normalizeControlDesignProjectPayload({ projectId: "P1", projectName: "Name", customer: "Customer", budget: "" }), /Budget is required/);
  assert.throws(() => normalizeControlDesignProjectPayload({ projectId: "P1", projectName: "Name", customer: "Customer", budget: "1" }), /Assigned Control Design member is required/);
  assert.throws(() => normalizeBudgetAmount("-1"), /Budget must be a non-negative decimal amount/);
  assert.throws(() => normalizeBudgetAmount("Infinity"), /Budget must be a non-negative decimal amount/);
  assert.throws(() => normalizeBudgetAmount("12,500"), /Budget must be a non-negative decimal amount/);
  assert.throws(() => normalizeBudgetAmount("12.345"), /Budget must be a non-negative decimal amount/);
});

test("Control Design completion requires all nine approved stages with no open work", () => {
  const approvedStages = CONTROL_DESIGN_STAGES.map((stageName, index) => ({
    id: "stage-" + (index + 1),
    stage_name: stageName,
    is_required: true,
    status: STAGE_STATUSES.APPROVED,
    submissions: [],
    revisions: [],
  }));

  assert.equal(isControlDesignLifecycleComplete(approvedStages), true);
  assert.equal(isControlDesignLifecycleComplete(approvedStages.slice(0, 8)), false);
  assert.equal(isControlDesignLifecycleComplete(approvedStages.map((stage, index) => (
    index === 8 ? { ...stage, status: STAGE_STATUSES.PRE_COMPLETED } : stage
  ))), false);
  assert.equal(isControlDesignLifecycleComplete(approvedStages.map((stage, index) => (
    index === 0 ? { ...stage, submissions: [{ status: SUBMISSION_STATUSES.PENDING }] } : stage
  ))), false);
  assert.equal(isControlDesignLifecycleComplete(approvedStages.map((stage, index) => (
    index === 0 ? { ...stage, revisions: [{ status: REVISION_STATUSES.IN_PROGRESS }] } : stage
  ))), false);
});

test("stage mutation reads acquire a row lock before evaluating workflow state", async () => {
  let capturedSql = "";
  const stage = await findWorkflowStage("stage-1", {
    async query(sql) {
      capturedSql = sql;
      return {
        rows: [{
          id: "stage-1",
          workflow_id: "workflow-1",
          stage_name: "CO Creation",
          sequence_order: 1,
          is_required: true,
          status: STAGE_STATUSES.NOT_STARTED,
        }],
      };
    },
  });

  assert.equal(stage.id, "stage-1");
  assert.match(capturedSql, /FOR UPDATE OF pws/);
});

test("workflow events persist stage audit details and structured metadata", async () => {
  let capturedSql = "";
  let capturedParams = [];
  const event = await insertWorkflowEvent({
    workflow_id: "workflow-1",
    workflow_stage_id: "stage-1",
    event_type: "comment_added",
    actor_id: "E0042",
    details: "Ready for review",
    metadata: { source: "stage_drawer" },
  }, {
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [{
          id: "event-1",
          workflow_id: params[0],
          workflow_stage_id: params[1],
          event_type: params[2],
          actor_id: params[3],
          details: params[4],
          metadata: JSON.parse(params[5]),
          created_at: "2026-07-14T00:00:00.000Z",
        }],
      };
    },
  });

  assert.match(capturedSql, /INSERT INTO control_workflow_events/);
  assert.equal(capturedParams[5], JSON.stringify({ source: "stage_drawer" }));
  assert.deepEqual(event.metadata, { source: "stage_drawer" });
});
