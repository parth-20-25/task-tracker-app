/**
 * WBS Header Parser — Single-Line Strict Parser
 *
 * Parses strings in the format:
 *   WBS-{project_code}-{scope_name}_{company_name}
 *
 * Example:
 *   WBS-PARC2600M001-Fuel Tank weld Line_Belrise Industries Limited
 *   → project_code: "PARC2600M001"
 *   → scope_name:   "Fuel Tank weld Line"
 *   → company_name: "Belrise Industries Limited"
 */

export interface WBSParseResult {
  project_code: string;
  scope_name: string;
  company_name: string;
}

export interface WBSParseError {
  valid: false;
  message: string;
}

export interface WBSParseSuccess extends WBSParseResult {
  valid: true;
}

export type WBSParseOutcome = WBSParseSuccess | WBSParseError;

/**
 * Normalizes a string for scope matching:
 * - lowercase
 * - trim
 * - remove non-letter characters
 * - collapse spaces
 */
export function normalizeWBS(str: string): string {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z]/g, "")
    .replace(/\s+/g, "");
}

/**
 * Parses a WBS Header string strictly.
 * Returns a typed outcome — never throws.
 *
 * Step 1: Must start with "WBS-"
 * Step 2: Remove "WBS-" prefix
 * Step 3: Split at first "-" → project_code + remaining
 * Step 4: Split remaining at first "_" → scope_name + company_name
 *         (company_name may itself contain underscores)
 */
export function parseWBSHeader(input: string): WBSParseOutcome {
  const trimmed = (input || "").trim();

  // Step 1: Prefix check
  if (!trimmed.startsWith("WBS-")) {
    return { valid: false, message: "Missing WBS- prefix" };
  }

  // Step 2: Remove prefix
  const header = trimmed.substring(4);

  // Step 3: Split at first "-"
  const firstDashIndex = header.indexOf("-");
  if (firstDashIndex === -1) {
    return { valid: false, message: "Invalid format: missing '-' separator" };
  }

  const project_code = header.substring(0, firstDashIndex).trim();
  const remaining = header.substring(firstDashIndex + 1).trim();

  if (!project_code) {
    return { valid: false, message: "Invalid format: project code is empty" };
  }

  // Step 4: Split remaining at first "_" (company name may contain underscores)
  const parts = remaining.split("_");
  if (parts.length < 2) {
    return { valid: false, message: "Invalid format: missing '_' separator" };
  }

  const scope_name = parts[0].trim();
  const company_name = parts.slice(1).join("_").trim();

  // Final validation
  if (!scope_name || !company_name) {
    return { valid: false, message: "Scope or Company name missing" };
  }

  return {
    valid: true,
    project_code,
    scope_name,
    company_name,
  };
}

/**
 * Returns true if the input is a valid WBS header string.
 */
export function isValidWBSHeader(input: string): boolean {
  return parseWBSHeader(input).valid;
}
