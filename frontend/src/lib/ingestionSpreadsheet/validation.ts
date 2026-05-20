import type { EditableColumnId, SpreadsheetRow } from "./types";

const FIXTURE_NUMBER_PATTERN = /^PARC\d{8,}$/i;

export interface CellValidationIssue {
  rowKey: string;
  columnId: EditableColumnId;
  message: string;
}

export function validateEditableCell(
  columnId: EditableColumnId,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Required";
  }
  if (columnId === "fixture_no" && !FIXTURE_NUMBER_PATTERN.test(trimmed)) {
    return "Fixture No must match PARC########";
  }
  if (columnId === "qty") {
    const qty = Number(trimmed);
    if (!Number.isFinite(qty) || qty <= 0) {
      return "QTY must be a positive number";
    }
  }
  if (columnId === "fixture_type" && /^(vendor|outsourced)$/i.test(trimmed)) {
    return "Add concrete fixture/process description, not bare vendor label";
  }
  return null;
}

export function buildRowValidationIssues(
  rows: SpreadsheetRow[],
  cellOverrides: Record<string, Partial<Record<EditableColumnId, string>>>,
): CellValidationIssue[] {
  const issues: CellValidationIssue[] = [];

  for (const row of rows) {
    if (!row.isEditable) {
      continue;
    }
    const override = cellOverrides[row.rowKey] || {};
    const values: Record<EditableColumnId, string> = {
      fixture_no: override.fixture_no ?? row.fixtureNo,
      part_name: override.part_name ?? row.partName,
      fixture_type: override.fixture_type ?? row.fixtureType,
      qty: override.qty ?? row.qty,
    };

    (Object.keys(values) as EditableColumnId[]).forEach((columnId) => {
      const message = validateEditableCell(columnId, values[columnId]);
      if (message) {
        issues.push({ rowKey: row.rowKey, columnId, message });
      }
    });
  }

  return issues;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
