export type ImageUploadStatus = "queued" | "uploading" | "done" | "failed";

export interface QueuedImageJob {
  id: string;
  fixtureId: string;
  file: File;
  previewUrl: string;
  status: ImageUploadStatus;
  error?: string;
}

export function createImageQueue() {
  const jobs: QueuedImageJob[] = [];
  let active = 0;
  const concurrency = 2;

  async function drain(
    uploader: (job: QueuedImageJob) => Promise<void>,
    onChange: () => void,
  ) {
    while (active < concurrency) {
      const next = jobs.find((job) => job.status === "queued");
      if (!next) {
        break;
      }
      active += 1;
      next.status = "uploading";
      onChange();
      try {
        await uploader(next);
        next.status = "done";
      } catch (error) {
        next.status = "failed";
        next.error = error instanceof Error ? error.message : "Upload failed";
      } finally {
        active -= 1;
        onChange();
        void drain(uploader, onChange);
      }
    }
  }

  return {
    list: () => jobs,
    enqueue(job: QueuedImageJob, uploader: (job: QueuedImageJob) => Promise<void>, onChange: () => void) {
      jobs.push(job);
      onChange();
      void drain(uploader, onChange);
    },
    retry(id: string, uploader: (job: QueuedImageJob) => Promise<void>, onChange: () => void) {
      const job = jobs.find((entry) => entry.id === id);
      if (!job) {
        return;
      }
      job.status = "queued";
      job.error = undefined;
      onChange();
      void drain(uploader, onChange);
    },
    clear() {
      jobs.length = 0;
    },
  };
}
