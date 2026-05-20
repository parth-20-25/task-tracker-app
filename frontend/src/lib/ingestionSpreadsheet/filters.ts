import type { SpreadsheetFilterState, SpreadsheetRow } from "./types";
import { isOutsourcedFixtureType } from "./gridModel";

export const DEFAULT_FILTER: SpreadsheetFilterState = {
  search: "",
  classification: "ALL",
  validationOnly: false,
  conflictsOnly: false,
  outsourcedOnly: false,
};

export function filterSpreadsheetRows(
  rows: SpreadsheetRow[],
  filter: SpreadsheetFilterState,
): SpreadsheetRow[] {
  const search = filter.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (filter.conflictsOnly && row.classification !== "CONFLICT") {
      return false;
    }
    if (filter.validationOnly && row.classification !== "INVALID" && row.classification !== "DUPLICATE") {
      return false;
    }
    if (filter.outsourcedOnly && !isOutsourcedFixtureType(row.fixtureType)) {
      return false;
    }
    if (filter.classification !== "ALL" && row.classification !== filter.classification) {
      return false;
    }
    if (search) {
      const haystack = [
        row.fixtureNo,
        row.partName,
        row.fixtureType,
        row.rowReference,
        row.errorMessage || "",
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

export function countRowsByClassification(rows: SpreadsheetRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] || 0) + 1;
    return acc;
  }, {});
}
