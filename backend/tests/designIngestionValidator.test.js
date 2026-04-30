const assert = require("node:assert/strict");

const { validateParsedData } = require("../services/designIngestion/validator");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("accepts explicit PARC scope rows", () => {
  const result = validateParsedData([
    {
      excel_row: 8,
      fixture_no: "PARC26001001",
      op_no: "OP 11",
      part_name: "STIFFNER MTG BKT LH/RH SUB ASSLY",
      fixture_type: "Robotic MIG Welding fixture",
      remark: "PARC scope",
      qty: "2",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.validRows[0].scope_status, "PARC");
  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.rejectedRows.length, 0);
});

runTest("skips explicit customer scope rows", () => {
  const result = validateParsedData([
    {
      excel_row: 9,
      fixture_no: "PARC26001002",
      op_no: "OP 12",
      part_name: "STIFFNER MTG BKT LH/RH SUB ASSLY",
      fixture_type: "Robotic MIG Welding fixture",
      remark: "Customer scope",
      qty: "1",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 0);
  assert.equal(result.skippedRows.length, 1);
  assert.match(result.skippedRows[0].skip_reason, /Customer scope/i);
});

runTest("keeps ambiguous scope rows pending explicit decision", () => {
  const result = validateParsedData([
    {
      excel_row: 10,
      fixture_no: "PARC26001003",
      op_no: "OP 13",
      part_name: "INNER BRACKET SUB ASSLY",
      fixture_type: "Checking fixture",
      remark: "",
      qty: "4",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.validRows[0].scope_status, "AMBIGUOUS");
  assert.match(result.validRows[0].scope_reason, /clearly defined scope/i);
});

runTest("rejects low-confidence rows", () => {
  const result = validateParsedData([
    {
      excel_row: 11,
      fixture_no: "PARC26001004",
      op_no: "OP 14",
      part_name: "LOW CONFIDENCE ROW",
      fixture_type: "Checking fixture",
      remark: "PARC scope",
      qty: "2",
      parser_confidence: "LOW",
    },
  ]);

  assert.equal(result.validRows.length, 0);
  assert.equal(result.rejectedRows.length, 1);
  assert.match(result.rejectedRows[0].error_message, /confidence/i);
});

runTest("rejects duplicate fixture numbers in the same upload", () => {
  const result = validateParsedData([
    {
      excel_row: 12,
      fixture_no: "PARC26001005",
      op_no: "OP 15",
      part_name: "OUTER BRACKET SUB ASSLY",
      fixture_type: "Checking fixture",
      remark: "PARC scope",
      qty: "2",
      parser_confidence: "HIGH",
    },
    {
      excel_row: 13,
      fixture_no: "PARC26001005",
      op_no: "OP 16",
      part_name: "OUTER BRACKET SUB ASSLY RH",
      fixture_type: "Checking fixture",
      remark: "PARC scope",
      qty: "3",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.rejectedRows.length, 1);
  assert.match(result.rejectedRows[0].error_message, /Duplicate fixture number/i);
});

console.log("designIngestion validator checks passed");
