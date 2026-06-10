export type NativeClassification =
  | "NEW"
  | "UPDATED"
  | "EXISTING"
  | "DUPLICATE"
  | "INVALID";

export type NativeSeverity = "safe" | "warning" | "error" | "idle";
export type NativeUploadMode = "full_project_update" | "fixture_delta";

export interface NativeIngestionContext {
  project_id?: string | null;
  project_identity: string;
  project_code: string;
  project_name: string;
  customer_name: string;
  department_id: string;
  department_name: string;
  upload_mode: NativeUploadMode;
}

export interface NativeImageStorageMeta {
  adapter?: "supabase" | "local";
  bucket?: string;
  path: string;
  staging: boolean;
  warning?: string;
}

export interface NativeIngestionIssue {
  severity: "error" | "warning";
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
  reference_image_url: string | null;
  is_workflow_complete: boolean;
  is_outsourced: boolean;
  vendor_name: string | null;
  assigned_team: string | null;
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
  assigned_team?: string;
  is_outsourced: boolean;
  vendor_name: string;
  reference_image_url: string;
  validation_state?: string;
  classification?: NativeClassification;
  severity?: NativeSeverity;
  cell_states?: Partial<Record<NativeEditableColumn | "validation_state", NativeSeverity>>;
  issues?: NativeIngestionIssue[];
  existing?: NativeExistingFixture | null;
  image_storage?: Partial<Record<"reference_image_url", NativeImageStorageMeta>>;
  storage_warning?: string | null;
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
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  deleted_fixture_nos?: string[];
  modified_fixture_nos?: string[];
  new_fixture_nos?: string[];
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
    assigned_team?: string | null;
    is_outsourced: boolean;
    vendor_name: string | null;
    reference_image_url: string | null;
    image_storage?: NativeIngestionRow["image_storage"];
  };
}

export interface NativeValidationResponse {
  session_id: string;
  context: NativeIngestionContext;
  rows: NativeValidatedRow[];
  summary: NativeValidationSummary;
}

export interface NativeStageImageResponse {
  public_url: string;
  image_slot: "reference_image_url";
  storage: NativeImageStorageMeta;
  warning?: string | null;
}

export interface NativeCommitResponse {
  success: boolean;
  session_id: string;
  batch_id: string | null;
  project_id: string;
  project_code: string;
  project_was_created: boolean;
  accepted_count: number;
  created_fixture_nos: string[];
  updated_fixture_nos: string[];
  deleted_fixture_nos: string[];
  unchanged_fixture_nos: string[];
}

export const NATIVE_COLUMNS = [
  "status",
  "fixture_no",
  "part_name",
  "fixture_type",
  "qty",
  "assigned_team",
  "reference_image_url",
  "remark",
  "is_outsourced",
  "vendor_name",
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
  | "reference_image_url";

export const NATIVE_EDITABLE_COLUMNS: NativeEditableColumn[] = [
  "fixture_no",
  "part_name",
  "fixture_type",
  "qty",
  "reference_image_url",
  "remark",
  "is_outsourced",
  "vendor_name",
];
