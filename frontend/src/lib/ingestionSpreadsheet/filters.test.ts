import { describe, expect, it } from "vitest";
import { filterSpreadsheetRows } from "./filters";
import type { SpreadsheetRow } from "./types";

const sampleRows: SpreadsheetRow[] = [
  {
    rowKey: "a",
    gridIndex: 0,
    rowNumber: 1,
    excelRow: 1,
    rowReference: "1",
    classification: "CONFLICT",
    diffType: "CONFLICT_PART_NAME",
    fixtureNo: "PARC25119001",
    partName: "A",
    fixtureType: "Checking fixture",
    qty: "1",
    remark: "",
    partImageUrl: null,
    problemFields: [],
    isEditable: false,
  },
  {
    rowKey: "b",
    gridIndex: 1,
    rowNumber: 2,
    excelRow: 2,
    rowReference: "2",
    classification: "INVALID",
    diffType: null,
    fixtureNo: "BAD",
    partName: "",
    fixtureType: "Outsourced",
    qty: "0",
    remark: "",
    partImageUrl: null,
    problemFields: ["fixture_no"],
    isEditable: true,
  },
];

describe("ingestionSpreadsheet filters", () => {
  it("filters conflicts only", () => {
    const result = filterSpreadsheetRows(sampleRows, {
      search: "",
      classification: "ALL",
      validationOnly: false,
      conflictsOnly: true,
      outsourcedOnly: false,
    });
    expect(result).toHaveLength(1);
    expect(result[0].classification).toBe("CONFLICT");
  });

  it("filters outsourced fixture types", () => {
    const result = filterSpreadsheetRows(sampleRows, {
      search: "",
      classification: "ALL",
      validationOnly: false,
      conflictsOnly: false,
      outsourcedOnly: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].fixtureType).toBe("Outsourced");
  });
});
