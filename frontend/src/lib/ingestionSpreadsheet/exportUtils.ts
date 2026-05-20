import type { SpreadsheetRow } from "./types";

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportSheetSnapshot(rows: SpreadsheetRow[], projectCode: string): void {
  const header = [
    "classification",
    "row_reference",
    "excel_row",
    "fixture_no",
    "part_name",
    "fixture_type",
    "qty",
    "remark",
    "error_message",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) => [
      row.classification,
      row.rowReference,
      row.excelRow ?? "",
      row.fixtureNo,
      row.partName,
      row.fixtureType,
      row.qty,
      row.remark,
      row.errorMessage || "",
    ].map((v) => escapeCsv(String(v))).join(",")),
  ];
  downloadText(`${projectCode}-ingestion-snapshot.csv`, lines.join("\n"));
}

export function exportValidationErrors(rows: SpreadsheetRow[], projectCode: string): void {
  const invalid = rows.filter((r) => r.classification === "INVALID" || r.classification === "DUPLICATE");
  const header = ["row_reference", "fixture_no", "classification", "error_message", "problem_fields"];
  const lines = [
    header.join(","),
    ...invalid.map((row) => [
      row.rowReference,
      row.fixtureNo,
      row.classification,
      row.errorMessage || "",
      row.problemFields.join("|"),
    ].map((v) => escapeCsv(String(v))).join(",")),
  ];
  downloadText(`${projectCode}-validation-errors.csv`, lines.join("\n"));
}

export function exportUnresolvedConflicts(
  rows: SpreadsheetRow[],
  decisions: Record<string, "incoming" | "existing">,
  projectCode: string,
): void {
  const conflicts = rows.filter((r) => r.classification === "CONFLICT");
  const header = [
    "fixture_no",
    "row_reference",
    "diff_type",
    "existing_part",
    "incoming_part",
    "existing_type",
    "incoming_type",
    "resolution",
  ];
  const lines = [
    header.join(","),
    ...conflicts.map((row) => {
      const key = row.incoming ? `${row.incoming.fixture_no}::${row.incoming.row_number}` : row.rowKey;
      return [
        row.fixtureNo,
        row.rowReference,
        row.diffType || "",
        row.existing?.part_name || "",
        row.incoming?.part_name || "",
        row.existing?.fixture_type || "",
        row.incoming?.fixture_type || "",
        decisions[key] || "unresolved",
      ].map((v) => escapeCsv(String(v))).join(",");
    }),
  ];
  downloadText(`${projectCode}-unresolved-conflicts.csv`, lines.join("\n"));
}
