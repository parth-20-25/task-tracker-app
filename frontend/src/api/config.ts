function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/g, "");
}

function resolveApiBaseUrl() {
  const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!configuredApiUrl || !configuredApiUrl.trim()) {
    throw new Error("NEXT_PUBLIC_API_URL is required for frontend API requests.");
  }

  const normalizedApiUrl = normalizeBaseUrl(configuredApiUrl);
  return normalizedApiUrl.endsWith("/api")
    ? normalizedApiUrl
    : `${normalizedApiUrl}/api`;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const API_ROOT_URL = API_BASE_URL.replace(/\/api$/, "");
