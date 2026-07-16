const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ADDITIONAL_DESIGN_2D_TASK_KINDS,
  ADDITIONAL_DESIGN_3D_TASK_KINDS,
  ADDITIONAL_DESIGN_TASK_KINDS,
  getAdditionalDesignTaskKindsForTeam,
  normalizeAdditionalDesignTaskKind,
  normalizeAdditionalDesignTeam,
  resolveAdditionalDesignTeamForUser,
  userBelongsToAdditionalDesignTeam,
} = require("../lib/additionalDesignTasks");
const { resolveTaskProofExtension } = require("../lib/taskProofUpload");
const {
  THREE_D_PROJECT_PROOF_OPTIONAL_KINDS,
  isTaskWorkProofRequired,
} = require("../lib/taskProofPolicy");
const { mapTaskRow } = require("../repositories/mappers");

test("additional design task catalog is subdivision specific", () => {
  assert.deepEqual(ADDITIONAL_DESIGN_2D_TASK_KINDS, [
    "Drafting",
    "Print & Drafting Checking",
    "BOM Checking",
    "Drawing Correction",
    "AutoCAD PDF",
    "IGES Data",
    "CMM Data",
    "Line Layout",
    "Mimic Display",
    "Wear-Out Data",
  ]);
  assert.deepEqual(ADDITIONAL_DESIGN_3D_TASK_KINDS, [
    "Project Process",
    "Pin Matrix",
    "PPT",
    "CBO",
    "Line Layout",
    "CDRM",
    "Print & Drafting Checking",
  ]);
  assert.deepEqual(getAdditionalDesignTaskKindsForTeam("3d"), ADDITIONAL_DESIGN_3D_TASK_KINDS);
  assert.equal(new Set(ADDITIONAL_DESIGN_TASK_KINDS).has("Drafting"), true);
  assert.equal(new Set(ADDITIONAL_DESIGN_TASK_KINDS).has("Project Process"), true);
});

test("additional task kind and team normalization is canonical and rejects wrong subdivision catalog values", () => {
  assert.equal(normalizeAdditionalDesignTaskKind(" bom checking ", "2D"), "BOM Checking");
  assert.equal(normalizeAdditionalDesignTaskKind(" bom checking ", "3D"), null);
  assert.equal(normalizeAdditionalDesignTaskKind(" pin matrix ", "3D"), "Pin Matrix");
  assert.equal(normalizeAdditionalDesignTaskKind("Production Drawing", "3D"), null);
  assert.equal(normalizeAdditionalDesignTeam("2d"), "2D");
  assert.equal(normalizeAdditionalDesignTeam("4D"), null);
});

test("backend resolves additional design team from authenticated user context", () => {
  assert.equal(resolveAdditionalDesignTeamForUser({
    department_id: "design",
    subdivision: { subdivision_name: "3D" },
  }), "3D");
  assert.equal(resolveAdditionalDesignTeamForUser({
    department: { name: "Design" },
    subdivision: { subdivision_name: "2D" },
  }), "2D");
  assert.equal(resolveAdditionalDesignTeamForUser({
    department_id: "control",
    subdivision: { subdivision_name: "3D" },
  }), null);
});

test("assignees must belong to the active selected Design subdivision", () => {
  const user = {
    department_id: "design",
    subdivision: { subdivision_name: "3D" },
    is_active: true,
  };
  assert.equal(userBelongsToAdditionalDesignTeam(user, "3D"), true);
  assert.equal(userBelongsToAdditionalDesignTeam(user, "2D"), false);
  assert.equal(userBelongsToAdditionalDesignTeam({ ...user, is_active: false }, "3D"), false);
  assert.equal(userBelongsToAdditionalDesignTeam({}, "3D"), false);
});

test("proof upload allowlist accepts required deliverables and rejects executable extensions", () => {
  assert.equal(resolveTaskProofExtension({ originalname: "drawing.pdf", mimetype: "application/pdf" }), ".pdf");
  assert.equal(resolveTaskProofExtension({ originalname: "surface.iges", mimetype: "application/octet-stream" }), ".iges");
  assert.equal(resolveTaskProofExtension({ originalname: "payload.exe", mimetype: "application/pdf" }), null);
  assert.equal(resolveTaskProofExtension({ originalname: "drawing.pdf.exe", mimetype: "application/octet-stream" }), null);
});

test("3D project additional proof policy makes only the requested project kinds proof optional", () => {
  for (const additionalTaskKind of THREE_D_PROJECT_PROOF_OPTIONAL_KINDS) {
    assert.equal(isTaskWorkProofRequired({
      task_type: "additional_design",
      proof_required: true,
      design_team: "3D",
      scope_type: "project",
      fixture_id: null,
      additional_task_kind: additionalTaskKind,
    }), false, additionalTaskKind);
  }

  assert.equal(isTaskWorkProofRequired({
    task_type: "additional_design",
    proof_required: true,
    design_team: "3D",
    scope_type: "project",
    fixture_id: null,
    additional_task_kind: "Print & Drafting Checking",
  }), true);
  assert.equal(isTaskWorkProofRequired({
    task_type: "additional_design",
    proof_required: true,
    design_team: "2D",
    scope_type: "project",
    fixture_id: null,
    additional_task_kind: "Line Layout",
  }), true);
});

test("task mapper preserves additional design category fields", () => {
  const task = mapTaskRow({
    id: 42,
    title: "Project Process",
    task_type: "additional_design",
    additional_task_kind: "Project Process",
    design_team: "3D",
    description: "Project-level process work",
    assigned_to: "EMP-3D-1",
    assignee_ids: '["EMP-3D-1"]',
    assigned_by: "LEAD-3D",
    department_id: "design",
    status: "assigned",
    verification_status: "pending",
    priority: "medium",
    deadline: "2026-07-16T00:00:00.000Z",
    created_at: "2026-07-15T00:00:00.000Z",
    proof_required: true,
    approval_required: true,
    scope_type: "project",
    project_id: "project-1",
    resolved_project_id: "project-1",
    resolved_project_no: "P-001",
    resolved_project_name: "Design Project",
  });

  assert.equal(task.additional_task_kind, "Project Process");
  assert.equal(task.design_team, "3D");
  assert.equal(task.fixture_id, null);
  assert.equal(task.scope_type, "project");
});
