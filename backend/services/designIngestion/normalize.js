/**
 * Canonical normalization for design spreadsheet ingestion.
 * Keeps fixture identity stable across whitespace/case/trailing-underscore drift.
 */

function collapseWhitespaceTrim(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical fixture number for identity (single source of truth for matching):
 * - trim + collapse spaces
 * - remove internal spaces
 * - strip trailing underscores
 * - strip leading/trailing ASCII hyphen / underscore noise (e.g. PARC001- vs PARC001_)
 * - uppercase
 *
 * Used everywhere ingestion matches DB rows: (project_id + canonicalFixtureNo(fixture_no)).
 */
function canonicalFixtureNo(value) {
  return collapseWhitespaceTrim(value)
    .replace(/\s+/g, "")
    .replace(/_+$/g, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toUpperCase();
}

/** Case-insensitive comparison field (part name, fixture type). */
function normalizeComparableText(value) {
  return collapseWhitespaceTrim(value).toLowerCase();
}

module.exports = {
  canonicalFixtureNo,
  collapseWhitespaceTrim,
  normalizeComparableText,
};
