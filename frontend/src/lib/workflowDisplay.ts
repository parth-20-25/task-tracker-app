export type WorkflowStageStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "APPROVED" | "REJECTED";

export function normalizeWorkflowStageName(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function formatWorkflowStageAbbreviation(stageName: string | null | undefined) {
  const normalizedStageName = normalizeWorkflowStageName(stageName);

  if (!normalizedStageName) {
    return "WF";
  }

  const firstToken = normalizedStageName.split(/\s+/)[0] || normalizedStageName;
  const tokenAbbreviation = firstToken.replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase();

  if (tokenAbbreviation) {
    return tokenAbbreviation;
  }

  const stripped = normalizedStageName.replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase();
  return stripped || "WF";
}

export function formatWorkflowRevisionCode(stageName: string | null | undefined, revisionNo: number | null | undefined) {
  const abbreviation = formatWorkflowStageAbbreviation(stageName);
  const normalizedRevision = Number.isFinite(Number(revisionNo)) ? Math.max(0, Math.floor(Number(revisionNo))) : 0;
  return `${abbreviation} ${String(normalizedRevision).padStart(2, "0")}`;
}

export function formatWorkflowStatusLabel(status: string | null | undefined) {
  switch (String(status || "").trim().toUpperCase()) {
    case "IN_PROGRESS":
      return "In Progress";
    case "PENDING":
      return "Pending";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "COMPLETED":
      return "Completed";
    default:
      return String(status || "").trim() || "Unknown";
  }
}

export function getWorkflowStatusTone(status: string | null | undefined) {
  switch (String(status || "").trim().toUpperCase()) {
    case "IN_PROGRESS":
      return "border-sky-300 bg-sky-50 text-sky-800";
    case "PENDING":
      return "border-amber-300 bg-amber-50 text-amber-800";
    case "APPROVED":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "REJECTED":
      return "border-red-300 bg-red-50 text-red-800";
    case "COMPLETED":
      return "border-violet-300 bg-violet-50 text-violet-800";
    default:
      return "border-slate-300 bg-slate-50 text-slate-700";
  }
}
