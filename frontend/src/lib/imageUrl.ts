import { API_ROOT_URL } from "@/api/config";

const failedImageUrls = new Set<string>();

export function resolveImageUrl(value: string | null | undefined) {
  const raw = String(value || "").trim();

  if (!raw) {
    return null;
  }

  if (raw.startsWith("data:image/") || raw.startsWith("blob:")) {
    return raw;
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (raw.startsWith("/")) {
    return `${API_ROOT_URL}${raw}`;
  }

  if (/^(uploads|design-excel|task-proofs)\//i.test(raw)) {
    return `${API_ROOT_URL}/${raw}`;
  }

  return null;
}

export function isKnownBrokenImageUrl(url: string | null | undefined) {
  return Boolean(url && failedImageUrls.has(url));
}

export function markBrokenImageUrl(url: string | null | undefined) {
  if (url) {
    failedImageUrls.add(url);
  }
}
