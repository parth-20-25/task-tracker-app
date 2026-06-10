import { apiDownload, apiRequest } from "@/api/http";
import type {
  NativeCommitResponse,
  NativeIngestionContext,
  NativeIngestionRow,
  NativeSessionResponse,
  NativeStageImageResponse,
  NativeValidationResponse,
} from "@/components/native-ingestion/NativeIngestionTypes";

export function createNativeIngestionSession(context: NativeIngestionContext) {
  return apiRequest<NativeSessionResponse>("/design/native-ingestion/sessions", {
    method: "POST",
    body: JSON.stringify({ context }),
  });
}

export function createNativeProjectEditSession(projectId: string, departmentId?: string | null) {
  return apiRequest<NativeSessionResponse>(
    `/design/native-ingestion/projects/${encodeURIComponent(projectId)}/edit-session`,
    {
      method: "POST",
      body: JSON.stringify({ department_id: departmentId || undefined }),
    },
  );
}

export function importNativeIngestionExcel(
  sessionId: string,
  context: NativeIngestionContext,
  file: File,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("context", JSON.stringify(context));

  return apiRequest<{ session_id: string; sheet_name: string; rows: NativeIngestionRow[] }>(
    `/design/native-ingestion/sessions/${encodeURIComponent(sessionId)}/import-excel`,
    {
      method: "POST",
      body: form,
    },
  );
}

export function pasteNativeIngestionClipboard(
  sessionId: string,
  context: NativeIngestionContext,
  text: string,
) {
  return apiRequest<{ session_id: string; rows: NativeIngestionRow[] }>(
    `/design/native-ingestion/sessions/${encodeURIComponent(sessionId)}/paste`,
    {
      method: "POST",
      body: JSON.stringify({ context, text }),
    },
  );
}

export function validateNativeIngestion(
  sessionId: string,
  context: NativeIngestionContext,
  rows: NativeIngestionRow[],
) {
  return apiRequest<NativeValidationResponse>(
    `/design/native-ingestion/sessions/${encodeURIComponent(sessionId)}/validate`,
    {
      method: "POST",
      body: JSON.stringify({ context, rows }),
    },
  );
}

export function stageNativeIngestionImage(
  sessionId: string,
  context: NativeIngestionContext,
  row: NativeIngestionRow,
  file: File,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("context", JSON.stringify(context));
  form.append("row_id", row.row_id);
  form.append("fixture_no", row.fixture_no);
  form.append("image_slot", "reference_image_url");

  return apiRequest<NativeStageImageResponse>(
    `/design/native-ingestion/sessions/${encodeURIComponent(sessionId)}/images/stage`,
    {
      method: "POST",
      body: form,
    },
  );
}

export function commitNativeIngestion(
  sessionId: string,
  context: NativeIngestionContext,
  rows: NativeIngestionRow[],
) {
  return apiRequest<NativeCommitResponse>(
    `/design/native-ingestion/sessions/${encodeURIComponent(sessionId)}/commit`,
    {
      method: "POST",
      body: JSON.stringify({ context, rows }),
    },
  );
}

export function downloadNativeIngestionTemplate() {
  return apiDownload("/design/native-ingestion/template", {
    filename: "native-fixture-ingestion-template.xlsx",
  });
}
