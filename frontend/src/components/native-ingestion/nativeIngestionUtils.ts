import type {
  NativeEditableColumn,
  NativeIngestionContext,
  NativeIngestionRow,
  NativeValidatedRow,
  NativeValidationResponse,
} from "./NativeIngestionTypes";

const EMPTY_ROWS = 24;

export function createEmptyNativeRow(index: number): NativeIngestionRow {
  return {
    row_id: `native-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    row_number: index + 1,
    status: "",
    fixture_no: "",
    part_name: "",
    fixture_type: "",
    remark: "",
    qty: "",
    is_outsourced: false,
    vendor_name: "",
    image_1_url: "",
    image_2_url: "",
    validation_state: "",
    severity: "idle",
    cell_states: {},
  };
}

export function buildInitialRows(): NativeIngestionRow[] {
  return Array.from({ length: EMPTY_ROWS }, (_, index) => createEmptyNativeRow(index));
}

export function padRows(rows: NativeIngestionRow[], minRows = EMPTY_ROWS): NativeIngestionRow[] {
  const normalized = rows.map((row, index) => ({
    ...createEmptyNativeRow(index),
    ...row,
    row_id: row.row_id || `native-row-${index + 1}`,
    row_number: Number(row.row_number) || index + 1,
    qty: row.qty === undefined || row.qty === null ? "" : String(row.qty),
    vendor_name: row.vendor_name || "",
    image_1_url: row.image_1_url || "",
    image_2_url: row.image_2_url || "",
  }));

  if (normalized.length >= minRows) {
    return normalized.map((row, index) => ({ ...row, row_number: index + 1 }));
  }

  return [
    ...normalized,
    ...Array.from({ length: minRows - normalized.length }, (_, offset) => createEmptyNativeRow(normalized.length + offset)),
  ];
}

export function nativeRowHasData(row: NativeIngestionRow) {
  return Boolean(
    row.fixture_no.trim()
    || row.part_name.trim()
    || row.fixture_type.trim()
    || row.remark.trim()
    || String(row.qty || "").trim()
    || row.vendor_name.trim()
    || row.image_1_url.trim()
    || row.image_2_url.trim()
    || row.is_outsourced,
  );
}

export function mergeValidationRows(
  currentRows: NativeIngestionRow[],
  validation: NativeValidationResponse,
): NativeIngestionRow[] {
  const byId = new Map(validation.rows.map((row) => [row.row_id, row]));
  return currentRows.map((row) => {
    const validated = byId.get(row.row_id);
    if (!validated) {
      return nativeRowHasData(row)
        ? row
        : {
          ...row,
          status: "",
          classification: undefined,
          severity: "idle",
          validation_state: "",
          cell_states: {},
          issues: [],
          existing: null,
        };
    }

    return applyValidatedRow(row, validated);
  });
}

export function applyValidatedRow(row: NativeIngestionRow, validated: NativeValidatedRow): NativeIngestionRow {
  return {
    ...row,
    row_number: validated.row_number,
    status: validated.classification,
    classification: validated.classification,
    severity: validated.severity,
    validation_state: validated.validation_state,
    cell_states: validated.cell_states,
    issues: validated.issues,
    existing: validated.existing || null,
    fixture_no: validated.incoming.fixture_no || row.fixture_no,
    part_name: validated.incoming.part_name || row.part_name,
    fixture_type: validated.incoming.fixture_type || row.fixture_type,
    remark: validated.incoming.remark ?? row.remark,
    qty: validated.incoming.qty === null || validated.incoming.qty === undefined
      ? row.qty
      : String(validated.incoming.qty),
    is_outsourced: validated.incoming.is_outsourced,
    vendor_name: validated.incoming.vendor_name || "",
    image_1_url: validated.incoming.image_1_url || row.image_1_url,
    image_2_url: validated.incoming.image_2_url || row.image_2_url,
    image_storage: validated.incoming.image_storage || row.image_storage,
  };
}

export function serializeCell(row: NativeIngestionRow, column: NativeEditableColumn): string {
  if (column === "is_outsourced") {
    return row.is_outsourced ? "TRUE" : "FALSE";
  }
  return String(row[column] ?? "");
}

export function parsePastedBoolean(value: string) {
  return ["1", "true", "yes", "y", "x", "checked", "outsourced"].includes(value.trim().toLowerCase());
}

export function patchRowCell(
  row: NativeIngestionRow,
  column: NativeEditableColumn,
  value: string | boolean,
): NativeIngestionRow {
  if (column === "is_outsourced") {
    const isChecked = typeof value === "boolean" ? value : parsePastedBoolean(value);
    return {
      ...row,
      is_outsourced: isChecked,
      vendor_name: isChecked ? row.vendor_name : "",
      severity: row.severity === "idle" ? "idle" : "warning",
    };
  }

  if (column === "vendor_name" && !row.is_outsourced) {
    return row;
  }

  return {
    ...row,
    [column]: String(value),
    severity: row.severity === "idle" ? "idle" : "warning",
    validation_state: row.validation_state || "Draft changed, validate before commit",
  };
}

export function parseClipboardMatrix(text: string): string[][] {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.trim()) {
    return [];
  }
  return normalized
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t").map((cell) => cell.replace(/\n+/g, " ").trim()));
}

export function defaultNativeContext(user: {
  department_id?: string;
  department?: { name?: string };
} | null): NativeIngestionContext {
  return {
    project_no: "",
    customer: "",
    department_id: user?.department_id || "",
    department_name: user?.department?.name || user?.department_id || "",
    vendor: "",
    operational_batch: "",
    revision: "0",
    upload_source: "native_workspace",
  };
}

export function contextReady(context: NativeIngestionContext) {
  return Boolean(context.project_no.trim() && context.customer.trim() && context.department_id.trim());
}
