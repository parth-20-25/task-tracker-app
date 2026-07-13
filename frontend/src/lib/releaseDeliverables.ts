export const RELEASE_DELIVERABLE_STATUS_LABELS: Record<string, string> = {
  LOCKED: "Locked",
  READY: "Ready",
  IN_PROGRESS: "In Progress",
  PENDING_APPROVAL: "Pending Approval",
  CHANGES_REQUIRED: "Changes Required",
  APPROVED: "Approved",
  NOT_APPLICABLE: "Not Applicable",
};

export function releaseDeliverableStatusLabel(status: string | null | undefined) {
  const key = String(status || "").trim().toUpperCase();
  return RELEASE_DELIVERABLE_STATUS_LABELS[key] || status || "Unknown";
}
