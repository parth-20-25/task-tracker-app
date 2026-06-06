import { apiRequest } from "@/api/http";
import { UploadBatch } from "@/types";

export function fetchBatches() {
  return apiRequest<UploadBatch[]>("/batches");
}

export function deleteBatch(batchId: string, force = false) {
  const suffix = force ? "?force=true" : "";
  return apiRequest<{ deleted: boolean; batch_id: string; force: boolean; message: string }>(`/batches/${batchId}${suffix}`, {
    method: "DELETE",
  });
}

export function holdBatchProject(batchId: string) {
  return apiRequest<{ project_id: string; batch_id: string; status: string; message: string }>(`/batches/${batchId}/on-hold`, {
    method: "POST",
  });
}

export function activateBatchProject(batchId: string) {
  return apiRequest<{ project_id: string; batch_id: string; status: string; message: string }>(`/batches/${batchId}/activate`, {
    method: "POST",
  });
}

export function releaseBatchProject(batchId: string) {
  return apiRequest<{ project_id: string; batch_id: string; status: string; message: string }>(`/batches/${batchId}/release`, {
    method: "POST",
  });
}
