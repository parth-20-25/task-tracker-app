const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ADDITIONAL_DESIGN_TASK_KINDS,
  isRetiredAdditionalDesignTask,
  normalizeAdditionalDesignTaskKind,
  normalizeAdditionalDesignTeam,
  userBelongsToAdditionalDesignTeam,
} = require("../lib/additionalDesignTasks");
const { resolveTaskProofExtension } = require("../lib/taskProofUpload");

test("additional design task catalog contains the required ten task kinds", () => {
  assert.deepEqual(ADDITIONAL_DESIGN_TASK_KINDS, [
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
});

test("additional task kind and team normalization is canonical and rejects unknown values", () => {
  assert.equal(normalizeAdditionalDesignTaskKind(" bom checking "), "BOM Checking");
  assert.equal(normalizeAdditionalDesignTaskKind("Production Drawing"), null);
  assert.equal(normalizeAdditionalDesignTeam("2d"), "2D");
  assert.equal(normalizeAdditionalDesignTeam("4D"), null);
});

test("assignees must belong to the selected Design subdivision", () => {
  const user = { subdivision: { subdivision_name: "3D" } };
  assert.equal(userBelongsToAdditionalDesignTeam(user, "3D"), true);
  assert.equal(userBelongsToAdditionalDesignTeam(user, "2D"), false);
  assert.equal(userBelongsToAdditionalDesignTeam({}, "3D"), false);
});

test("legacy 2D creation is retired while unrelated 3D tasks remain available", () => {
  assert.equal(isRetiredAdditionalDesignTask("Drafting", "2D"), true);
  assert.equal(isRetiredAdditionalDesignTask("Drafting", "3D"), false);
  assert.equal(isRetiredAdditionalDesignTask("Unknown", "2D"), false);
});

test("proof upload allowlist accepts required deliverables and rejects executable extensions", () => {
  assert.equal(resolveTaskProofExtension({ originalname: "drawing.pdf", mimetype: "application/pdf" }), ".pdf");
  assert.equal(resolveTaskProofExtension({ originalname: "surface.iges", mimetype: "application/octet-stream" }), ".iges");
  assert.equal(resolveTaskProofExtension({ originalname: "payload.exe", mimetype: "application/pdf" }), null);
  assert.equal(resolveTaskProofExtension({ originalname: "drawing.pdf.exe", mimetype: "application/octet-stream" }), null);
});
