import type {
  DesignExcelPreviewRow,
  DesignExcelRejectedRow,
  DesignExcelUploadResponse,
} from "@/types";

export type IngestionClassification =
  | "NEW"
  | "UPDATED"
  | "EXISTING"
  | "CONFLICT"
  | "DUPLICATE"
  | "INVALID"
  | "SKIPPED";

export type SpreadsheetColumnId =
  | "status"
  | "row_ref"
  | "fixture_no"
  | "part_name"
  | "fixture_type"
  | "qty"
  | "remark"
  | "part_image"
  | "conflict";

export type EditableColumnId = "fixture_no" | "part_name" | "fixture_type" | "qty";

export interface SpreadsheetRow {
  rowKey: string;
  gridIndex: number;
  rowNumber: number;
  excelRow: number | null;
  rowReference: string;
  classification: IngestionClassification;
  diffType: string | null;
  conflictKind?: string | null;
  fixtureNo: string;
  partName: string;
  fixtureType: string;
  qty: string;
  remark: string;
  partImageUrl: string | null;
  incoming?: DesignExcelPreviewRow;
  existing?: DesignExcelPreviewRow;
  rejected?: DesignExcelRejectedRow;
  errorMessage?: string;
  problemFields: string[];
  skipReason?: string;
  isEditable: boolean;
}

export interface CellCoord {
  rowIndex: number;
  columnId: SpreadsheetColumnId;
}

export interface SelectionRange {
  start: CellCoord;
  end: CellCoord;
}

export interface SpreadsheetFilterState {
  search: string;
  classification: IngestionClassification | "ALL";
  validationOnly: boolean;
  conflictsOnly: boolean;
  outsourcedOnly: boolean;
}

export interface SpreadsheetSessionSnapshot {
  sessionId: string;
  expiresAt: string | null;
  savedAt: string;
  decisions: Record<string, "incoming" | "existing">;
  cellOverrides: Record<string, Partial<Record<EditableColumnId, string>>>;
  filter: SpreadsheetFilterState;
  uploadMode: "excel" | "paste";
}

export interface SpreadsheetWorkspaceProps {
  preview: DesignExcelUploadResponse;
  uploadMode: "excel" | "paste";
  decisions: Record<string, "incoming" | "existing">;
  onDecisionsChange: (next: Record<string, "incoming" | "existing">) => void;
  correctionDrafts: Record<string, Record<EditableColumnId, string>>;
  onCorrectionDraftsChange: (next: Record<string, Record<EditableColumnId, string>>) => void;
  onSyncRejectedDraft: (rejected: DesignExcelRejectedRow, draft: Record<EditableColumnId, string>) => void;
  onValidateRejectedRow: (rejected: DesignExcelRejectedRow) => Promise<void>;
  validatingRejectedKey: string | null;
  queuedPreviewImages: Record<string, { part?: { file: File; previewUrl: string } }>;
  onQueuePartImage: (rowKey: string, file: File) => void;
  onConfirm: () => void;
  onCancelPreview: () => void;
  isConfirming: boolean;
  hasUnresolvedConflicts: boolean;
}

export const EDITABLE_COLUMNS: EditableColumnId[] = [
  "fixture_no",
  "part_name",
  "fixture_type",
  "qty",
];

export const COLUMN_LABELS: Record<SpreadsheetColumnId, string> = {
  status: "Status",
  row_ref: "Row",
  fixture_no: "Fixture No",
  part_name: "Part Name",
  fixture_type: "Fixture Type",
  qty: "QTY",
  remark: "Remark",
  part_image: "Part Image",
  conflict: "Resolution",
};

export const GRID_COLUMNS: SpreadsheetColumnId[] = [
  "status",
  "row_ref",
  "fixture_no",
  "part_name",
  "fixture_type",
  "qty",
  "remark",
  "part_image",
  "conflict",
];

export const ROW_HEIGHT_PX = 44;
export const OVERSCAN = 8;
