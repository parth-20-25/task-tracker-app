import type { User } from "@/types";
import type {
  NativeEditableColumn,
  NativeIngestionContext,
  NativeIngestionRow,
  NativeUploadMode,
  NativeValidatedRow,
  NativeValidationResponse,
} from "./NativeIngestionTypes";

const EMPTY_ROWS = 24;

function legacyReferenceImage(row: NativeIngestionRow & { image_1_url?: string }) {
  return row.reference_image_url || row.image_1_url || "";
}

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
    assigned_team: "",
    is_outsourced: false,
    vendor_name: "",
    reference_image_url: "",
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
    assigned_team: row.assigned_team || row.existing?.assigned_team || "",
    vendor_name: row.vendor_name || "",
    reference_image_url: legacyReferenceImage(row as NativeIngestionRow & { image_1_url?: string }),
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
    || row.reference_image_url.trim()
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
          assigned_team: "",
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
    assigned_team: validated.incoming.assigned_team || validated.existing?.assigned_team || row.assigned_team || "",
    is_outsourced: validated.incoming.is_outsourced,
    vendor_name: validated.incoming.vendor_name || "",
    reference_image_url: validated.incoming.reference_image_url || row.reference_image_url,
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
      validation_state: "Changed since validation",
    };
  }

  if (column === "vendor_name" && !row.is_outsourced) {
    return row;
  }

  return {
    ...row,
    [column]: String(value),
    severity: row.severity === "idle" ? "idle" : "warning",
    validation_state: "Changed since validation",
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

function collapseIdentityWhitespace(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLegacyWbsPrefix(value: unknown) {
  return collapseIdentityWhitespace(value).replace(/^WBS\s*[-_]?\s*/i, "");
}

function normalizeProjectCode(value: unknown) {
  return stripLegacyWbsPrefix(value)
    .replace(/\s+/g, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toUpperCase();
}

function splitOnLastSeparator(value: string) {
  const spacedSeparator = [...value.matchAll(/\s+[-_]\s+/g)].pop();
  if (spacedSeparator?.index !== undefined) {
    return [
      value.slice(0, spacedSeparator.index),
      value.slice(spacedSeparator.index + spacedSeparator[0].length),
    ];
  }

  const multiSpace = [...value.matchAll(/\s{2,}/g)].pop();
  if (multiSpace?.index !== undefined) {
    return [
      value.slice(0, multiSpace.index),
      value.slice(multiSpace.index + multiSpace[0].length),
    ];
  }

  const looseDash = value.lastIndexOf("-");
  const looseUnderscore = value.lastIndexOf("_");
  const index = Math.max(looseDash, looseUnderscore);
  if (index > 0) {
    return [value.slice(0, index), value.slice(index + 1)];
  }

  return [value, ""];
}

export function parseProjectIdentityInput(value: string) {
  const rawIdentity = stripLegacyWbsPrefix(value);
  if (!rawIdentity) {
    return { project_code: "", project_name: "", customer_name: "" };
  }

  const identity = collapseIdentityWhitespace(rawIdentity);
  const firstSplit = rawIdentity.match(/^([^\s\-_]+)(?:\s*[-_]\s*|\s{2,})(.+)$/);
  if (!firstSplit) {
    return {
      project_code: normalizeProjectCode(identity),
      project_name: "",
      customer_name: "",
    };
  }

  const [projectName, customerName] = splitOnLastSeparator(firstSplit[2]).map(collapseIdentityWhitespace);

  return {
    project_code: normalizeProjectCode(firstSplit[1]),
    project_name: projectName,
    customer_name: customerName,
  };
}

export function formatProjectIdentity(context: Partial<NativeIngestionContext>) {
  return [
    normalizeProjectCode(context.project_code),
    context.project_name,
    context.customer_name,
  ].map(collapseIdentityWhitespace).filter(Boolean).join(" - ");
}

export function normalizeUploadMode(value: unknown): NativeUploadMode {
  return value === "fixture_delta" ? "fixture_delta" : "full_project_update";
}

export function hydrateProjectIdentityContext(
  context: NativeIngestionContext,
  identityValue = context.project_identity,
): NativeIngestionContext {
  const parsed = parseProjectIdentityInput(identityValue);
  const displayIdentity = stripLegacyWbsPrefix(identityValue);
  const next = {
    ...context,
    project_identity: displayIdentity,
    project_code: parsed.project_code,
    project_name: parsed.project_name,
    customer_name: parsed.customer_name,
  };

  return {
    ...next,
    project_identity: displayIdentity || formatProjectIdentity(next),
  };
}

export function defaultNativeContext(user: User | null): NativeIngestionContext {
  const departmentId = user?.department_id || "";
  return {
    project_identity: "",
    project_code: "",
    project_name: "",
    customer_name: "",
    department_id: departmentId,
    department_name: departmentId ? user?.department?.name || departmentId : "",
    upload_mode: "full_project_update",
  };
}

export function contextReady(context: NativeIngestionContext) {
  return Boolean(
    context.project_code.trim()
    && context.project_name.trim()
    && context.customer_name.trim()
    && context.department_id.trim(),
  );
}
