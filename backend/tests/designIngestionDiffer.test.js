const assert = require("node:assert/strict");

const { diffWithDatabase } = require("../services/designIngestion/differ");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("preserves existing image URLs when an update row has no new image", () => {
  const result = diffWithDatabase(
    [
      {
        fixture_no: "PARC26001001",
        op_no: "OP 10",
        part_name: "PART A",
        fixture_type: "Checking fixture",
        qty: 2,
        image_1_url: null,
        image_2_url: null,
      },
    ],
    [
      {
        fixture_no: "PARC26001001",
        op_no: "OP 10",
        part_name: "PART A",
        fixture_type: "Checking fixture",
        qty: 1,
        image_1_url: "https://example.supabase.co/storage/v1/object/public/design-images/a.png",
        image_2_url: null,
      },
    ],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].type, "UPDATE_QTY");
  assert.equal(
    result[0].incoming.image_1_url,
    "https://example.supabase.co/storage/v1/object/public/design-images/a.png",
  );
});

runTest("matches existing fixtures when incoming fixture_no has trailing hyphen noise", () => {
  const result = diffWithDatabase(
    [
      {
        fixture_no: "PARC26001001-",
        part_name: "Part A",
        fixture_type: "Checking fixture",
        qty: 1,
        image_1_url: null,
        image_2_url: null,
      },
    ],
    [
      {
        fixture_no: "PARC26001001",
        part_name: "Part A",
        fixture_type: "Checking fixture",
        qty: 1,
        image_1_url: null,
        image_2_url: null,
      },
    ],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].type, "UNCHANGED");
});

runTest("matches existing fixtures using canonical fixture_no casing", () => {
  const result = diffWithDatabase(
    [
      {
        fixture_no: "parc26001001",
        part_name: "Part A",
        fixture_type: "Checking fixture",
        qty: 1,
        image_1_url: null,
        image_2_url: null,
      },
    ],
    [
      {
        fixture_no: "PARC26001001",
        part_name: "Part A",
        fixture_type: "Checking fixture",
        qty: 1,
        image_1_url: null,
        image_2_url: null,
      },
    ],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].type, "UNCHANGED");
  assert.equal(result[0].classification, "EXISTING");
});

console.log("designIngestion differ checks passed");
