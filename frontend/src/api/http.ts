import { ApiError } from "@/lib/api/ApiError";
import { API_BASE_URL } from "@/api/config";

export function getStoredToken() {
  return localStorage.getItem("token");
}

function parsePayload(text: string) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem("token", token);
    return;
  }

  localStorage.removeItem("token");
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;

  if (!headers.has("Content-Type") && init.body && !isFormData) {
    headers.set("Content-Type", "application/json");
  }

  const token = getStoredToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    throw new ApiError(
      `Network request failed while reaching ${API_BASE_URL}`,
      0,
      error instanceof Error ? { cause: error.message } : undefined,
      "network_error",
    );
  }

  const text = await response.text();
  let payload: { success?: boolean; data?: T; error?: string; message?: string; details?: unknown; errorCode?: string } | null = null;
  
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.message || payload?.error || "Request failed",
      response.status,
      payload?.details,
      payload?.errorCode
    );
  }

  if (payload && payload.success === true && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data as T;
  }

  return payload as T;
}

export async function apiDownload(path: string, options: { filename: string }, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getStoredToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (!response.ok) {
    const text = await response.text();
    let payload: { error?: string; message?: string; details?: unknown; errorCode?: string } | null = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_error) {
      payload = null;
    }
    throw new ApiError(
      payload?.message || payload?.error || "Download failed",
      response.status,
      payload?.details,
      payload?.errorCode
    );
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = options.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
