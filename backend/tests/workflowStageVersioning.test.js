const assert = require("node:assert/strict");

const {
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

runTest("formats repeated stage entries with two digit versions", () => {
  assert.equal(getStageVersionFromCompletedCount(1), 1);
  assert.equal(formatStageVersionLabel("Concept", 1), "Concept01");
  assert.equal(formatStageVersionLabel("3D", 2), "3D02");
  assert.equal(formatStageVersionLabel("DAP", 12), "DAP12");
});

console.log("workflow stage versioning checks passed");
