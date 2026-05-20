const assert = require("node:assert/strict");

const { DESIGN_STAGE_REVISION_PREFIXES, getDesignStageRevisionPrefix } = require("../lib/designRevisionPrefixes");
const {
  normalizeDesignRevisionReasonType,
  getDesignRevisionReasonLabel,
} = require("../lib/designRevisionTypes");
const {
  formatStageRevisionCode,
  normalizeRevisionCodeInput,
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

runTest("centralized design revision prefixes", () => {
  assert.equal(DESIGN_STAGE_REVISION_PREFIXES.concept, "CON");
  assert.equal(DESIGN_STAGE_REVISION_PREFIXES["2d_finish"], "2D");
  assert.equal(DESIGN_STAGE_REVISION_PREFIXES.detailing, "DET");
  assert.equal(getDesignStageRevisionPrefix("3D Finish"), "3D");
  assert.equal(getDesignStageRevisionPrefix("Detailing"), "DET");
});

runTest("canonical revision code formatting", () => {
  assert.equal(formatStageRevisionCode("Concept", 0), "CON 00");
  assert.equal(formatStageRevisionCode("Concept", 2), "CON 02");
  assert.equal(formatStageRevisionCode("2D Finish", 1), "2D 01");
  assert.equal(formatStageRevisionCode("Detailing", 3), "DET 03");
});

runTest("normalizes messy revision inputs", () => {
  assert.equal(normalizeRevisionCodeInput("con2"), "CON 02");
  assert.equal(normalizeRevisionCodeInput("Con-02"), "CON 02");
  assert.equal(normalizeRevisionCodeInput("CON 02"), "CON 02");
  assert.equal(normalizeRevisionCodeInput("02", "Concept"), "CON 02");
});

runTest("requires authoritative reason_type", () => {
  const missing = normalizeDesignRevisionReasonType(null, { required: true });
  assert.equal(missing.ok, false);

  const valid = normalizeDesignRevisionReasonType("CUSTOMER_CHANGE", { required: true });
  assert.equal(valid.ok, true);
  assert.equal(valid.value, "CUSTOMER_CHANGE");
  assert.equal(getDesignRevisionReasonLabel("CUSTOMER_CHANGE"), "Customer Change");
});

console.log("design revision checks passed");
