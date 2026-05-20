import type { SpreadsheetSessionSnapshot } from "./types";

const STORAGE_PREFIX = "ingestion-spreadsheet-draft:";

export function draftStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function saveSessionDraft(snapshot: SpreadsheetSessionSnapshot): void {
  try {
    localStorage.setItem(draftStorageKey(snapshot.sessionId), JSON.stringify(snapshot));
  } catch {
    // Quota or private mode — non-fatal
  }
}

export function loadSessionDraft(sessionId: string): SpreadsheetSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(draftStorageKey(sessionId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as SpreadsheetSessionSnapshot;
    if (parsed?.sessionId !== sessionId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSessionDraft(sessionId: string): void {
  try {
    localStorage.removeItem(draftStorageKey(sessionId));
  } catch {
    // ignore
  }
}

export function hasMeaningfulDraft(snapshot: SpreadsheetSessionSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  return (
    Object.keys(snapshot.decisions).length > 0
    || Object.keys(snapshot.cellOverrides).length > 0
    || snapshot.filter.search.trim().length > 0
    || snapshot.filter.classification !== "ALL"
    || snapshot.filter.validationOnly
    || snapshot.filter.conflictsOnly
    || snapshot.filter.outsourcedOnly
  );
}
