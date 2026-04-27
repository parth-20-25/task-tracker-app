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
