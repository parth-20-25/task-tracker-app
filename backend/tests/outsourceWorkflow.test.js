const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canCompleteWorkflowAfterOutsource,
  canonicalizeOutsourceStage,
  getOutsourceCompletionAutoApproveStageNames,
  mergeRecentSupplierNames,
  normalizeOutsourceStages,
  normalizeSupplierName,
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

test("outsourced completion can close when only outsourced and release stages remain", () => {
  const progressRows = [
    { stage_name: "Concept", status: "PENDING" },
    { stage_name: "DAP", status: "APPROVED" },
    { stage_name: "3D Finish", status: "PENDING" },
    { stage_name: "2D Finish", status: "PENDING" },
    { stage_name: "Release", status: "PENDING" },
  ];

  assert.equal(canCompleteWorkflowAfterOutsource(progressRows, ["Concept", "3D", "2D"]), true);
  assert.deepEqual(
    getOutsourceCompletionAutoApproveStageNames(progressRows, ["Concept", "3D", "2D"]),
    ["Concept", "3D Finish", "2D Finish", "Release"],
  );
});

test("outsourced completion does not close while DAP is pending", () => {
  const progressRows = [
    { stage_name: "Concept", status: "PENDING" },
    { stage_name: "DAP", status: "PENDING" },
    { stage_name: "3D Finish", status: "PENDING" },
  ];

  assert.equal(canCompleteWorkflowAfterOutsource(progressRows, ["Concept", "3D"]), false);
  assert.deepEqual(
    getOutsourceCompletionAutoApproveStageNames(progressRows, ["Concept", "3D"]),
    ["Concept", "3D Finish"],
  );
});

test("outsourced completion does not close with non-outsourced internal work pending", () => {
  const progressRows = [
    { stage_name: "Concept", status: "PENDING" },
    { stage_name: "DAP", status: "APPROVED" },
    { stage_name: "3D Finish", status: "PENDING" },
  ];

  assert.equal(canCompleteWorkflowAfterOutsource(progressRows, ["3D"]), false);
});
