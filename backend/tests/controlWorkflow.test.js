const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  CONTROL_DESIGN_STAGES,
  CONTROL_SUB_DEPARTMENTS,
  REVISION_REASONS,
  STAGE_STATUSES,
  assertOtherReasonHasManualRemarks,
  calculateWorkflowProgress,
  canStartStage,
  canSubmitStage,
  createInitialStageRows,
  isApprovedForProgress,
  isControlDepartmentUser,
  isControlDesignSubdivisionUser,
  isControlDesignWorkspaceUser,
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
    permissions: [PERMISSIONS.CONTROL_DESIGN_CREATE_PROJECTS],
  };

  assert.equal(canCreateControlDesignProject(controlDesignLeader, subDepartmentId), true);
  assert.doesNotThrow(() => requireControlDesignCreatePermission(controlDesignLeader, subDepartmentId));

  const regularControlDesignUser = {
    ...controlDesignLeader,
    employee_id: "EMP-CD-1",
    role: { id: "r6", name: "Engineer", permissions: {} },
    permissions: [],
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

test("Control Design create permission is seeded for leadership roles only", () => {
  for (const roleId of ["r1", "r2", "r3", "r4"]) {
    assert.equal(ROLE_DEFAULT_PERMISSIONS[roleId].includes(PERMISSIONS.CONTROL_DESIGN_CREATE_PROJECTS), true);
  }

  for (const roleId of ["r5", "r6", "r7"]) {
    assert.equal(ROLE_DEFAULT_PERMISSIONS[roleId].includes(PERMISSIONS.CONTROL_DESIGN_CREATE_PROJECTS), false);
  }
});

test("frontend and backend declare the same Control Design create permission", () => {
  const frontendPermissions = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/lib/permissions.ts"),
    "utf8",
  );

  assert.equal(PERMISSIONS.CONTROL_DESIGN_CREATE_PROJECTS, "control_design.create_projects");
  assert.match(frontendPermissions, /CONTROL_DESIGN_CREATE_PROJECTS:\s*"control_design\.create_projects"/);
});

test("Control Design project creation validation trims required fields and normalizes INR budget", () => {
  assert.deepEqual(normalizeControlDesignProjectPayload({
    projectId: " PARC2600M029 ",
    projectName: " U546 Frame Auto Revising SPM ",
    customer: " Tata Motors ",
    budget: "001250000.5",
  }), {
    project_no: "PARC2600M029",
    project_name: "U546 Frame Auto Revising SPM",
    customer_name: "Tata Motors",
    budget_amount: "1250000.50",
  });

  assert.equal(normalizeBudgetAmount("0"), "0.00");
  assert.equal(normalizeBudgetAmount("12.34"), "12.34");

  assert.throws(() => normalizeControlDesignProjectPayload({ projectId: " ", projectName: "Name", customer: "Customer", budget: "1" }), /Project ID is required/);
  assert.throws(() => normalizeControlDesignProjectPayload({ projectId: "P1", projectName: " ", customer: "Customer", budget: "1" }), /Project Name is required/);
  assert.throws(() => normalizeControlDesignProjectPayload({ projectId: "P1", projectName: "Name", customer: " ", budget: "1" }), /Customer is required/);
  assert.throws(() => normalizeControlDesignProjectPayload({ projectId: "P1", projectName: "Name", customer: "Customer", budget: "" }), /Budget is required/);
  assert.throws(() => normalizeBudgetAmount("-1"), /Budget must be a non-negative decimal amount/);
  assert.throws(() => normalizeBudgetAmount("Infinity"), /Budget must be a non-negative decimal amount/);
  assert.throws(() => normalizeBudgetAmount("12,500"), /Budget must be a non-negative decimal amount/);
  assert.throws(() => normalizeBudgetAmount("12.345"), /Budget must be a non-negative decimal amount/);
});
