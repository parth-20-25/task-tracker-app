const CACHE_PREFIX = "tasktracker.reference";
const CACHE_VERSION = "v1";
const DEPARTMENTS_TTL_MS = 5 * 60 * 1000;

type CacheEnvelope<T> = {
  cachedAt: number;
  value: T;
};

function getStorageKey(key: string) {
  return `${CACHE_PREFIX}.${CACHE_VERSION}.${key}`;
}

function readEnvelope<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(key));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.cachedAt !== "number") {
      return null;
    }

    return parsed;
  } catch (_error) {
    return null;
  }
}

function writeEnvelope<T>(key: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getStorageKey(key), JSON.stringify({
      cachedAt: Date.now(),
      value,
    }));
  } catch (_error) {
    // Ignore storage failures; cache is only a UX enhancement.
  }
}

export function getCachedDepartments<T>(key: string): T | null {
  const envelope = readEnvelope<T>(key);
  if (!envelope) {
    return null;
  }

  if (Date.now() - envelope.cachedAt > DEPARTMENTS_TTL_MS) {
    return null;
  }

  return envelope.value;
}

export function setCachedDepartments<T>(key: string, value: T) {
  writeEnvelope(key, value);
}
