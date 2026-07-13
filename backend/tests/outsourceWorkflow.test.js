const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canCompleteWorkflowAfterOutsource,
  canonicalizeOutsourceStage,
  getOutsourceCompletionAutoApproveStageNames,
  mergeRecentSupplierNames,
  normalizeOutsourceStages,
  normalizeSupplierName,
  resolveOutsourceStageCompletion,
} = require("../lib/outsourceWorkflow");

test("normalizes one outsourced stage", () => {
  assert.deepEqual(normalizeOutsourceStages(["Concept"]), {
    stages: ["Concept"],
    error: null,
  });
});

test("normalizes multiple outsourced stages with 3D and 2D aliases", () => {
  assert.deepEqual(normalizeOutsourceStages(["concept", "3d_finish", "2D"]), {
    stages: ["Concept", "3D", "2D"],
    error: null,
  });
});

test("deduplicates repeated outsourced stages", () => {
  assert.deepEqual(normalizeOutsourceStages(["3D", "3d", "3D Finish"]), {
    stages: ["3D"],
    error: null,
  });
});

test("rejects DAP as an outsourced stage", () => {
  const result = normalizeOutsourceStages(["DAP"]);
  assert.deepEqual(result.stages, []);
  assert.match(result.error, /Invalid outsourced stage/);
  assert.equal(canonicalizeOutsourceStage("DAP"), null);
});

test("requires at least one outsourced stage", () => {
  const result = normalizeOutsourceStages([]);
  assert.deepEqual(result.stages, []);
  assert.match(result.error, /At least one/);
});

test("normalizes supplier names", () => {
  assert.equal(normalizeSupplierName("  Supplier   X  "), "Supplier X");
  assert.equal(normalizeSupplierName(""), "");
});

test("recent suppliers keep last six unique names most recent first", () => {
  assert.deepEqual(
    mergeRecentSupplierNames(
      ["Supplier G", "Supplier F", "supplier g", "Supplier E"],
      ["Supplier D", "Supplier C", "Supplier B", "Supplier A"],
    ),
    ["Supplier G", "Supplier F", "Supplier E", "Supplier D", "Supplier C", "Supplier B"],
  );
});

test("outsourced completion only approves the current outsourced stage", () => {
  const progressRows = [
    { stage_name: "Concept", status: "PENDING" },
    { stage_name: "DAP", status: "APPROVED" },
    { stage_name: "3D Finish", status: "PENDING" },
    { stage_name: "2D Finish", status: "PENDING" },
    { stage_name: "Release", status: "PENDING" },
  ];

  const transition = resolveOutsourceStageCompletion(progressRows, ["Concept", "3D", "2D"]);
  assert.equal(transition.canComplete, true);
  assert.equal(transition.currentStageName, "Concept");
  assert.equal(transition.nextStageName, "3D Finish");
  assert.equal(transition.workflowMarkedComplete, false);
  assert.deepEqual(transition.remainingOutsourcedStageNames, ["3D Finish", "2D Finish"]);
  assert.equal(canCompleteWorkflowAfterOutsource(progressRows, ["Concept", "3D", "2D"]), false);
  assert.deepEqual(
    getOutsourceCompletionAutoApproveStageNames(progressRows, ["Concept", "3D", "2D"]),
    ["Concept"],
  );
});

test("outsourced completion waits while DAP is the current internal stage", () => {
  const progressRows = [
    { stage_name: "Concept", status: "APPROVED" },
    { stage_name: "DAP", status: "PENDING" },
    { stage_name: "3D Finish", status: "PENDING" },
  ];

  const transition = resolveOutsourceStageCompletion(progressRows, ["Concept", "3D"]);
  assert.equal(transition.canComplete, false);
  assert.equal(transition.currentStageName, "DAP");
  assert.equal(transition.currentStageIsOutsourced, false);
  assert.equal(canCompleteWorkflowAfterOutsource(progressRows, ["Concept", "3D"]), false);
  assert.deepEqual(
    getOutsourceCompletionAutoApproveStageNames(progressRows, ["Concept", "3D"]),
    [],
  );
});

test("3D outsourced completion advances to internal 2D without completing workflow", () => {
  const progressRows = [
    { stage_name: "Concept", status: "APPROVED" },
    { stage_name: "DAP", status: "APPROVED" },
    { stage_name: "3D Finish", status: "PENDING" },
    { stage_name: "2D Finish", status: "PENDING" },
  ];

  const transition = resolveOutsourceStageCompletion(progressRows, ["3D"]);
  assert.equal(transition.canComplete, true);
  assert.equal(transition.currentStageName, "3D Finish");
  assert.equal(transition.nextStageName, "2D Finish");
  assert.equal(transition.workflowMarkedComplete, false);
  assert.deepEqual(transition.stageNamesToApprove, ["3D Finish"]);
  assert.equal(canCompleteWorkflowAfterOutsource(progressRows, ["3D"]), false);
});

test("2D outsourced completion hands off to Release without completing workflow", () => {
  const progressRows = [
    { stage_name: "Concept", status: "APPROVED" },
    { stage_name: "DAP", status: "APPROVED" },
    { stage_name: "3D Finish", status: "APPROVED" },
    { stage_name: "2D Finish", status: "PENDING" },
    { stage_name: "Release", status: "PENDING" },
  ];

  const transition = resolveOutsourceStageCompletion(progressRows, ["2D"]);
  assert.equal(transition.canComplete, true);
  assert.equal(transition.currentStageName, "2D Finish");
  assert.equal(transition.nextStageName, "Release");
  assert.equal(transition.workflowMarkedComplete, false);
  assert.deepEqual(transition.stageNamesToApprove, ["2D Finish"]);
  assert.equal(canCompleteWorkflowAfterOutsource(progressRows, ["2D"]), false);
});

test("concept plus 3D outsourced leaves DAP internal and advances 3D to internal 2D", () => {
  const conceptTransition = resolveOutsourceStageCompletion([
    { stage_name: "Concept", stage_order: 1, status: "PENDING" },
    { stage_name: "DAP", stage_order: 2, status: "PENDING" },
    { stage_name: "3D Finish", stage_order: 3, status: "PENDING" },
    { stage_name: "2D Finish", stage_order: 4, status: "PENDING" },
  ], ["Concept", "3D"]);
  assert.equal(conceptTransition.canComplete, true);
  assert.equal(conceptTransition.currentStageName, "Concept");
  assert.equal(conceptTransition.nextStageName, "DAP");
  assert.deepEqual(conceptTransition.stageNamesToApprove, ["Concept"]);
  assert.deepEqual(conceptTransition.remainingOutsourcedStageNames, ["3D Finish"]);

  const dapTransition = resolveOutsourceStageCompletion([
    { stage_name: "Concept", stage_order: 1, status: "APPROVED" },
    { stage_name: "DAP", stage_order: 2, status: "PENDING" },
    { stage_name: "3D Finish", stage_order: 3, status: "PENDING" },
    { stage_name: "2D Finish", stage_order: 4, status: "PENDING" },
  ], ["Concept", "3D"]);
  assert.equal(dapTransition.canComplete, false);
  assert.equal(dapTransition.currentStageName, "DAP");
  assert.equal(dapTransition.currentStageIsOutsourced, false);
  assert.deepEqual(dapTransition.remainingOutsourcedStageNames, ["3D Finish"]);

  const threeDTransition = resolveOutsourceStageCompletion([
    { stage_name: "Concept", stage_order: 1, status: "APPROVED" },
    { stage_name: "DAP", stage_order: 2, status: "APPROVED" },
    { stage_name: "3D Finish", stage_order: 3, status: "PENDING" },
    { stage_name: "2D Finish", stage_order: 4, status: "PENDING" },
  ], ["Concept", "3D"]);
  assert.equal(threeDTransition.canComplete, true);
  assert.equal(threeDTransition.currentStageName, "3D Finish");
  assert.equal(threeDTransition.nextStageName, "2D Finish");
  assert.deepEqual(threeDTransition.stageNamesToApprove, ["3D Finish"]);
  assert.deepEqual(threeDTransition.remainingOutsourcedStageNames, []);
  assert.equal(threeDTransition.workflowMarkedComplete, false);
});

test("concept plus 3D plus 2D outsourced follows the expected staged sequence", () => {
  const conceptTransition = resolveOutsourceStageCompletion([
    { stage_name: "Concept", stage_order: 1, status: "PENDING" },
    { stage_name: "DAP", stage_order: 2, status: "PENDING" },
    { stage_name: "3D Finish", stage_order: 3, status: "PENDING" },
    { stage_name: "2D Finish", stage_order: 4, status: "PENDING" },
  ], ["Concept", "3D", "2D"]);
  assert.equal(conceptTransition.currentStageName, "Concept");
  assert.equal(conceptTransition.nextStageName, "DAP");
  assert.deepEqual(conceptTransition.stageNamesToApprove, ["Concept"]);

  const dapTransition = resolveOutsourceStageCompletion([
    { stage_name: "Concept", stage_order: 1, status: "APPROVED" },
    { stage_name: "DAP", stage_order: 2, status: "PENDING" },
    { stage_name: "3D Finish", stage_order: 3, status: "PENDING" },
    { stage_name: "2D Finish", stage_order: 4, status: "PENDING" },
  ], ["Concept", "3D", "2D"]);
  assert.equal(dapTransition.currentStageName, "DAP");
  assert.equal(dapTransition.canComplete, false);

  const threeDTransition = resolveOutsourceStageCompletion([
    { stage_name: "Concept", stage_order: 1, status: "APPROVED" },
    { stage_name: "DAP", stage_order: 2, status: "APPROVED" },
    { stage_name: "3D Finish", stage_order: 3, status: "PENDING" },
    { stage_name: "2D Finish", stage_order: 4, status: "PENDING" },
  ], ["Concept", "3D", "2D"]);
  assert.equal(threeDTransition.currentStageName, "3D Finish");
  assert.equal(threeDTransition.nextStageName, "2D Finish");
  assert.deepEqual(threeDTransition.stageNamesToApprove, ["3D Finish"]);

  const twoDTransition = resolveOutsourceStageCompletion([
    { stage_name: "Concept", stage_order: 1, status: "APPROVED" },
    { stage_name: "DAP", stage_order: 2, status: "APPROVED" },
    { stage_name: "3D Finish", stage_order: 3, status: "APPROVED" },
    { stage_name: "2D Finish", stage_order: 4, status: "PENDING" },
  ], ["Concept", "3D", "2D"]);
  assert.equal(twoDTransition.currentStageName, "2D Finish");
  assert.equal(twoDTransition.nextStageName, null);
  assert.equal(twoDTransition.workflowMarkedComplete, false);
  assert.deepEqual(twoDTransition.remainingOutsourcedStageNames, []);
});
