function normalizeStageVersion(value: unknown): number {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

function normalizeStageName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getStageRevisionPrefix(stageName: unknown): string {
  const normalized = normalizeStageName(stageName);

  if (["concept", "concept_stage"].includes(normalized)) {
    return "CON";
  }

  if (["dap", "d_a_p"].includes(normalized)) {
    return "DAP";
  }

  if (["3d", "3d_finish", "three_d", "three_d_finish"].includes(normalized)) {
    return "3D";
  }

  if (["2d", "2d_finish", "two_d", "two_d_finish", "detailing", "detail"].includes(normalized)) {
    return "DET";
  }

  const fallback = String(stageName || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 3)
    .toUpperCase();

  return fallback || "REV";
}

export function formatStageRevisionCode(
  stageName: string | null | undefined,
  stageVersion: number | null | undefined = 0,
): string | null {
  const normalizedStageName = String(stageName || "").trim();

  if (!normalizedStageName) {
    return null;
  }

  const prefix = getStageRevisionPrefix(normalizedStageName);
  const version = String(normalizeStageVersion(stageVersion)).padStart(2, "0");
  return `${prefix} ${version}`;
}

export function getWorkflowStageDisplayLabel(stageName: string | null | undefined): string | null {
  const normalizedStageName = String(stageName || "").trim();

  if (!normalizedStageName) {
    return null;
  }

  return normalizedStageName.toUpperCase();
}

export function getWorkflowStatusLabel(status: string | null | undefined): string | null {
  if (!status) {
    return null;
  }

  return String(status)
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
