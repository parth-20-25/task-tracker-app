const assert = require("node:assert/strict");

const { parsePasteData } = require("../services/designIngestion/parser");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("parses semantic rows without relying on fixed headers", () => {
  const input = [
    "PARC FIXTURE LIST",
    "WBS-PARC26-BIWS_ABC LIMITED",
    "Design Fixture Review",
    "Sr No\tFixture Number\tOperation\tPart Name\tFixture Category\tQty\tDesigner\tPart Image\tFixture Image",
    "1\tPARC26001001\tOP 110A\tSTIFFNER MTG BKT LH/RH SUB ASSLY\tRobotic MIG Welding fixture\t2\tJohn Doe\t\t",
    "2\tPARC26001002\tOP.NO 170.\tINNER BRACKET SUB ASSLY.\tChecking fixture.\t1\tPARC scope\t.\t.",
  ].join("\n");

  const result = parsePasteData(input);

  assert.equal(result.file_info.project_code, "PARC26");
  assert.equal(result.file_info.project_name, "BIWS");
  assert.equal(result.file_info.company_name, "ABC LIMITED");
  assert.equal(result.parsedRows.length, 2);
  assert.equal(result.parsedRows[0].fixture_no, "PARC26001001");
  assert.equal(result.parsedRows[0].op_no, "OP 110A");
  assert.equal(result.parsedRows[0].qty, "2");
  assert.equal(result.parsedRows[0].designer, "John Doe");
  assert.equal(result.parsedRows[1].parser_confidence, "HIGH");
});

runTest("keeps data-like rows without fixture numbers for hard rejection later", () => {
  const input = [
    "WBS-PARC25-PROJECT_ONE_ABC LTD",
    "S.NO\tOP.NO\tREMARKS",
    "1\tOP 170\tCustomer Scope",
  ].join("\n");

  const result = parsePasteData(input);

  assert.equal(result.parsedRows.length, 1);
  assert.equal(result.parsedRows[0].fixture_no, "");
  assert.equal(result.parsedRows[0].op_no, "OP 170");
});

runTest("detects compact and dotted OP.NO values during paste parsing", () => {
  const input = [
    "WBS-PARC25-PROJECT_ONE_ABC LTD",
    "S.NO\tFixture No\tOP.NO\tPart Name\tFixture Type\tQty",
    "1\tPARC25001001\tOP7A\tPart A\tChecking fixture\t1",
    "2\tPARC25001002\tOp. 10B\tPart B\tChecking fixture\t2",
  ].join("\n");

  const result = parsePasteData(input);

  assert.equal(result.parsedRows.length, 2);
  assert.equal(result.parsedRows[0].op_no, "OP7A");
  assert.equal(result.parsedRows[1].op_no, "Op. 10B");
});

runTest("parses WBS titles with mixed underscore and dash separators", () => {
  const inputs = [
    [
      "WBS-PARC2500M119_Oil Retainer Parts_Belrise Industries LTD_Pune",
      "Sr No\tFixture No\tOP.NO\tPart Name\tFixture Type\tQty",
      "1\tPARC25001191\tOP 10\tOil seal\tChecking fixture\t1",
    ].join("\n"),
    [
      "WBS - PARC2600M001 - Fuel Tank weld Line - Belrise Industries Limited",
      "Sr No\tFixture Number\tOperation No\tPart Name\tFixture Type\tQTY",
      "1\tPARC26000001\tOP 20\tTank bracket\tChecking fixture\t2",
    ].join("\n"),
  ];

  const first = parsePasteData(inputs[0]);
  assert.equal(first.file_info.project_code, "PARC2500M119");
  assert.equal(first.file_info.project_name, "Oil Retainer Parts");
  assert.equal(first.file_info.company_name, "Belrise Industries LTD");

  const second = parsePasteData(inputs[1]);
  assert.equal(second.file_info.project_code, "PARC2600M001");
  assert.equal(second.file_info.project_name, "Fuel Tank weld Line");
  assert.equal(second.file_info.company_name, "Belrise Industries Limited");
});

console.log("designIngestion parser checks passed");
