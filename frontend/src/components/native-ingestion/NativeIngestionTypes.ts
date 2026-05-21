export type NativeClassification =
  | "NEW"
  | "UPDATED"
  | "EXISTING"
  | "DUPLICATE"
  | "CONFLICT"
  | "INVALID";

export type NativeSeverity = "safe" | "warning" | "conflict" | "error" | "idle";

export interface NativeIngestionContext {
  project_no: string;
  customer: string;
  department_id: string;
  department_name: string;
  vendor: string;
  operational_batch: string;
  revision: string;
  upload_source: string;
}

export interface NativeImageStorageMeta {
  bucket?: string;
  path: string;
  staging: boolean;
}

export interface NativeIngestionIssue {
  severity: "error" | "warning" | "conflict";
  code: string;
  message: string;
  columns: NativeEditableColumn[];
}

export interface NativeExistingFixture {
  fixture_id: string;
  fixture_no: string;
  part_name: string;
  fixture_type: string;
  remark: string | null;
  qty: number;
  image_1_url: string | null;
  image_2_url: string | null;
  revision_no: number;
  is_workflow_complete: boolean;
  is_outsourced: boolean;
  vendor_name: string | null;
}

export interface NativeIngestionRow {
  row_id: string;
  row_number: number;
  status?: NativeClassification | "";
  fixture_no: string;
  part_name: string;
  fixture_type: string;
  remark: string;
  qty: string;
  is_outsourced: boolean;
  vendor_name: string;
  image_1_url: string;
  image_2_url: string;
  validation_state?: string;
  classification?: NativeClassification;
  severity?: NativeSeverity;
  cell_states?: Partial<Record<NativeEditableColumn | "validation_state", NativeSeverity>>;
  issues?: NativeIngestionIssue[];
  existing?: NativeExistingFixture | null;
  image_storage?: Partial<Record<"image_1_url" | "image_2_url", NativeImageStorageMeta>>;
}

export interface NativeSessionResponse {
  session_id: string;
  expires_at: string | null;
  context: NativeIngestionContext;
  rows: NativeIngestionRow[];
}

export interface NativeValidationSummary {
  total_rows: number;
  by_classification: Record<string, number>;
  error_rows: number;
  warning_rows: number;
  conflict_rows: number;
}

export interface NativeValidatedRow {
  row_id: string;
  row_number: number;
  classification: NativeClassification;
  severity: Exclude<NativeSeverity, "idle">;
  status: NativeClassification;
  validation_state: string;
  cell_states: Partial<Record<NativeEditableColumn | "validation_state", NativeSeverity>>;
  issues: NativeIngestionIssue[];
  existing?: NativeExistingFixture | null;
  incoming: {
    row_id: string;
    row_number: number;
    fixture_no: string;
    part_name: string;
    fixture_type: string;
    remark: string | null;
    qty: number | null;
    is_outsourced: boolean;
    vendor_name: string | null;
    image_1_url: string | null;
    image_2_url: string | null;
    image_storage?: NativeIngestionRow["image_storage"];
  };
}

export interface NativeValidationResponse {
  session_id: string;
  context: NativeIngestionContext;
  rows: NativeValidatedRow[];
  conflicts: NativeValidatedRow[];
  summary: NativeValidationSummary;
}

export interface NativeStageImageResponse {
  public_url: string;
  image_slot: "image_1_url" | "image_2_url";
  storage: NativeImageStorageMeta;
}

export interface NativeCommitResponse {
  success: boolean;
  session_id: string;
  batch_id: string;
  accepted_count: number;
  created_fixture_nos: string[];
  updated_fixture_nos: string[];
  skipped_count: number;
}

export const NATIVE_COLUMNS = [
  "status",
  "fixture_no",
  "part_name",
  "fixture_type",
  "remark",
  "qty",
  "is_outsourced",
  "vendor_name",
  "image_1_url",
  "image_2_url",
  "validation_state",
] as const;

export type NativeColumn = typeof NATIVE_COLUMNS[number];

export type NativeEditableColumn =
  | "fixture_no"
  | "part_name"
  | "fixture_type"
  | "remark"
  | "qty"
  | "is_outsourced"
  | "vendor_name"
  | "image_1_url"
  | "image_2_url";

export const NATIVE_EDITABLE_COLUMNS: NativeEditableColumn[] = [
  "fixture_no",
  "part_name",
  "fixture_type",
  "remark",
  "qty",
  "is_outsourced",
  "vendor_name",
  "image_1_url",
  "image_2_url",
];
