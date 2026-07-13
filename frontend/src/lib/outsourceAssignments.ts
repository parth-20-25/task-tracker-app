export const FIXTURE_OUTSOURCE_STATUS_LABELS: Record<string, string> = {
  OUTSOURCED: "Outsourced",
  IN_PROGRESS: "Vendor work in progress",
  SUBMITTED: "Submitted",
  PENDING_INTERNAL_REVIEW: "Pending internal review",
  CHANGES_REQUIRED: "Changes required",
  APPROVED: "Internally approved",
  CANCELLED: "Cancelled",
};

export function fixtureOutsourceStatusLabel(status: string | null | undefined) {
  const normalized = String(status || "").trim().toUpperCase();
  return FIXTURE_OUTSOURCE_STATUS_LABELS[normalized]
    || normalized.replace(/_/g, " ").toLowerCase().replace(/^./, (value) => value.toUpperCase())
    || "Unknown";
}
