/**
 * Design ingestion → operational workflow merge contract (spreadsheet is NOT authoritative
 * for workflow execution state).
 *
 * SAFE TO APPLY FROM INGESTION (metadata / catalog truth only):
 * - part_name, fixture_type, qty
 * - remark (remarks / notes from sheet)
 * - image_1_url (native reference image; image_2_url remains legacy-compatible and is not populated by native upload)
 * - ingestion_source, batch_id (provenance of last catalog write)
 * - is_outsourced, vendor_name, outsourced_at, outsourced_by (only when ingestion explicitly supplies outsourcing intent)
 *
 * NEVER AUTO-APPLY FROM INGESTION:
 * - workflow stage / progress / fixture_workflow_progress rows (except inserting PENDING shells for brand-new fixtures)
 * - tasks (assignments), assigned_to, lifecycle, completion_percent
 * - approvals, verification_status, proof attachment records
 * - fixture_workflow_stage_attempts, fixture_workflow_revisions, contributor rows
 * - is_workflow_complete, revision_no, is_legacy_workflow
 *
 * ASSIGNMENT PRESERVATION:
 * - No UPDATE/DELETE on tasks or progress during merge; new fixtures only get ON CONFLICT DO NOTHING progress inserts.
 *
 * REMOVED ROWS (catalog membership):
 * - Never DELETE fixtures; optional soft lifecycle via removed_from_latest_ingestion when catalog_membership_mode = full_replace.
 */

const INGESTION_SAFE_FIXTURE_COLUMNS = Object.freeze([
  "part_name",
  "fixture_type",
  "qty",
  "remark",
  "image_1_url",
  "image_2_url",
  "ingestion_source",
  "batch_id",
  "is_outsourced",
  "vendor_name",
  "outsourced_at",
  "outsourced_by",
]);

const CATALOG_MEMBERSHIP_MODES = Object.freeze({
  DELTA: "delta",
  FULL_REPLACE: "full_replace",
});

module.exports = {
  INGESTION_SAFE_FIXTURE_COLUMNS,
  CATALOG_MEMBERSHIP_MODES,
};
