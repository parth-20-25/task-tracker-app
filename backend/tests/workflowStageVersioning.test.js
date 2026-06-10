const assert = require("node:assert/strict");

const {
  formatStageRevisionCode,
  formatStageVersionLabel,
  getStageVersionFromCompletedCount,
  normalizeStageVersion,
} = require("../lib/workflowStageVersioning");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("keeps first stage entry unversioned", () => {
  assert.equal(normalizeStageVersion(0), 0);
  assert.equal(formatStageVersionLabel("Concept", 0), "Concept");
});

runTest("keeps stage labels fixed and formats separate revision codes", () => {
  assert.equal(getStageVersionFromCompletedCount(1), 1);
  assert.equal(formatStageVersionLabel("Concept", 1), "Concept");
  assert.equal(formatStageRevisionCode("Concept", 1), "CON 01");
  assert.equal(formatStageRevisionCode("DAP", 1), "DAP 01");
  assert.equal(formatStageRevisionCode("3D Finish", 1), "3D 01");
  assert.equal(formatStageRevisionCode("2D Finish", 1), "2D 01");
  assert.equal(formatStageRevisionCode("3D Finish", 2), "3D 02");
  assert.equal(formatStageRevisionCode("DAP", 12), "DAP 12");
  assert.equal(formatStageRevisionCode("2D Finish", 2), "2D 02");
  assert.equal(formatStageRevisionCode("Detailing", 3), "DET 03");
});

console.log("workflow stage versioning checks passed");
