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

runTest("accepts valid fixture rows", () => {
  const result = validateParsedData([
    {
      excel_row: 8,
      row_number: 1,
      row_reference: "1",
      row_reference_source: "business_serial",
      business_row_reference: "1",
      fixture_no: "PARC26001001",
      op_no: "OP 11",
      part_name: "STIFFNER MTG BKT LH/RH SUB ASSLY",
      fixture_type: "Robotic MIG Welding fixture",
      qty: "2",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.validRows[0].row_reference, "1");
  assert.equal(result.validRows[0].excel_row, 8);
  assert.equal(result.validRows[0].row_reference_source, "business_serial");
  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.rejectedRows.length, 0);
});

runTest("accepts valid fixture rows with any text data", () => {
  const result = validateParsedData([
    {
      excel_row: 9,
      fixture_no: "PARC26001002",
      op_no: "OP 12",
      part_name: "STIFFNER MTG BKT LH/RH SUB ASSLY",
      fixture_type: "Robotic MIG Welding fixture",
      qty: "1",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.rejectedRows.length, 0);
});

runTest("accepts rows with minimal required fields", () => {
  const result = validateParsedData([
    {
      excel_row: 10,
      fixture_no: "PARC26001003",
      op_no: "OP 13",
      part_name: "INNER BRACKET SUB ASSLY",
      fixture_type: "Checking fixture",
      qty: "4",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.skippedRows.length, 0);
});

runTest("accepts OP.NO values with letter suffixes and preserves them exactly", () => {
  const result = validateParsedData([
    {
      excel_row: 10,
      fixture_no: "PARC26001003",
      op_no: "Op. 10AB",
      part_name: "INNER BRACKET SUB ASSLY",
      fixture_type: "Checking fixture",
      qty: "4",
      parser_confidence: "HIGH",
    },
    {
      excel_row: 11,
      fixture_no: "PARC26001004",
      op_no: "OP7A",
      part_name: "OUTER BRACKET SUB ASSLY",
      fixture_type: "Checking fixture",
      qty: "2",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 2);
  assert.equal(result.validRows[0].op_no, "OP 10AB");
  assert.equal(result.validRows[1].op_no, "OP 7A");
  assert.equal(result.rejectedRows.length, 0);
});

runTest("preserves permanent image URLs from workbook extraction", () => {
  const result = validateParsedData([
    {
      excel_row: 18,
      fixture_no: "PARC26001008",
      op_no: "OP 18",
      part_name: "IMAGE PART",
      fixture_type: "Checking fixture",
      qty: "1",
      image_1_url: "https://example.supabase.co/storage/v1/object/public/design-images/a.png",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(
    result.validRows[0].image_1_url,
    "https://example.supabase.co/storage/v1/object/public/design-images/a.png",
  );
  assert.equal(result.validRows[0].image_2_url, null);
});

runTest("ignores remarks during validation output", () => {
  const result = validateParsedData([
    {
      excel_row: 19,
      fixture_no: "PARC26001009",
      op_no: "OP 19",
      part_name: "REMARK PART",
      fixture_type: "Checking fixture",
      qty: "1",
      remark: "Customer Scope",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(Object.hasOwn(result.validRows[0], "remark"), false);
});

runTest("does not reject rows only because parser confidence is low", () => {
  const result = validateParsedData([
    {
      excel_row: 11,
      fixture_no: "PARC26001004",
      op_no: "OP 14",
      part_name: "LOW CONFIDENCE ROW",
      fixture_type: "Checking fixture",
      qty: "2",
      parser_confidence: "LOW",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.rejectedRows.length, 0);
});

runTest("rejects duplicate fixture numbers in the same upload", () => {
  const result = validateParsedData([
    {
      excel_row: 12,
      fixture_no: "PARC26001005",
      op_no: "OP 15",
      part_name: "OUTER BRACKET SUB ASSLY",
      fixture_type: "Checking fixture",
      qty: "2",
      parser_confidence: "HIGH",
    },
    {
      excel_row: 13,
      fixture_no: "PARC26001005",
      op_no: "OP 16",
      part_name: "OUTER BRACKET SUB ASSLY RH",
      fixture_type: "Checking fixture",
      qty: "3",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.rejectedRows.length, 1);
  assert.match(result.rejectedRows[0].error_message, /Duplicate fixture number/i);
});

runTest("rejects rows that do not contain a fixture number", () => {
  const result = validateParsedData([
    {
      excel_row: 22,
      row_number: 14,
      row_reference: "14",
      row_reference_source: "business_serial",
      business_row_reference: "14",
      fixture_no: "",
      op_no: "OP 170",
      part_name: "Some Part",
      fixture_type: "Checking fixture",
      qty: "1",
      parser_confidence: "MEDIUM",
    },
  ]);

  assert.equal(result.validRows.length, 0);
  assert.equal(result.rejectedRows.length, 1);
  assert.equal(result.rejectedRows[0].row_reference, "14");
  assert.equal(result.rejectedRows[0].excel_row, 22);
  assert.equal(result.rejectedRows[0].raw_data.validation.problem_fields[0], "fixture_no");
  assert.match(result.rejectedRows[0].error_message, /Fixture No is mandatory/i);
});

runTest("rejects rows without OP.NO", () => {
  const result = validateParsedData([
    {
      row_number: 16,
      fixture_no: "PARC25119009",
      op_no: "",
      part_name: "Dry Leak Testing SPM",
      fixture_type: "LEAK TEST SPM",
      qty: "1",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 0);
  assert.equal(result.rejectedRows.length, 1);
  assert.equal(result.rejectedRows[0].raw_data.validation.problem_fields[0], "op_no");
});

runTest("normalizes numeric formatting noise for QTY and OP.NO", () => {
  const result = validateParsedData([
    {
      row_number: 17,
      fixture_no: "PARC26001007",
      op_no: "10.0",
      part_name: "LH BRACKET SUB ASSLY",
      fixture_type: "Checking fixture",
      qty: "2.0",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.validRows[0].op_no, "OP 10");
  assert.equal(result.validRows[0].qty, 2);
});

runTest("rejects OP.NO values where letters appear before the number", () => {
  const result = validateParsedData([
    {
      row_number: 15,
      fixture_no: "PARC26001006",
      op_no: "OP A10",
      part_name: "STIFFNER MTG BKT",
      fixture_type: "Checking fixture",
      qty: "2",
      parser_confidence: "HIGH",
    },
  ]);

  assert.equal(result.validRows.length, 0);
  assert.equal(result.rejectedRows.length, 1);
  assert.equal(result.rejectedRows[0].raw_data.validation.problem_fields[0], "op_no");
});

console.log("designIngestion validator checks passed");
