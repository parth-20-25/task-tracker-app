const { AppError } = require("../../lib/AppError");
const { resolveAccessibleDepartmentId } = require("../../lib/departmentContext");
const { pool } = require("../../db");
const { hasOrgWideVisibility } = require("../visibilityResolutionService");
const {
  buildVisibleUsersCte,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("../../repositories/projectVisibility");
const {
  collapseWhitespace,
  normalizeComparable,
  normalizeFixtureNo,
  normalizeNativeContext,
  normalizeNativeRow,
  normalizeProjectCode,
  isEmptyNativeRow,
} = require("./normalization");

const ISSUE_SEVERITY = Object.freeze({
  ERROR: "error",
  WARNING: "warning",
});

function resolveNativeDepartmentId(user, requestedDepartmentId, options = {}) {
  const {
    requireDepartment = true,
    message = "Invalid native ingestion department context",
  } = options;
  const departmentId = collapseWhitespace(requestedDepartmentId);

  if (departmentId || !hasOrgWideVisibility(user)) {
    return resolveAccessibleDepartmentId(user, departmentId, message);
  }

  if (requireDepartment) {
    throw new AppError(400, "department_id is required for native ingestion operation");
  }

  return null;
}

function cellStateFromIssues(issues) {
  const cellStates = {};
  for (const issue of issues) {
    for (const column of issue.columns || []) {
      if (issue.severity === ISSUE_SEVERITY.ERROR) {
        cellStates[column] = "error";
      } else if (!cellStates[column]) {
        cellStates[column] = "warning";
      }
    }
  }
  return cellStates;
}

function addIssue(issues, severity, code, message, columns = []) {
  issues.push({ severity, code, message, columns });
}

function isValidImageReference(value) {
  const image = collapseWhitespace(value);
  if (!image) {
    return true;
  }
  if (/^https?:\/\/\S+$/i.test(image)) {
    return true;
  }
  if (/^\/uploads\/\S+$/i.test(image)) {
    return true;
  }
  if (/^data:image\/(png|jpe?g|gif|webp|bmp|heic|heif);base64,[A-Za-z0-9+/=\s]+$/i.test(image)) {
    return true;
  }
  return false;
}

function normalizeExistingFixture(row) {
  if (!row) {
    return null;
  }

  return {
    fixture_id: row.fixture_id,
    project_id: row.project_id,
    fixture_no: row.fixture_no,
    canonical_fixture_no: normalizeFixtureNo(row.fixture_no),
    part_name: row.part_name || "",
    fixture_type: row.fixture_type || "",
    remark: row.remark || null,
    qty: Number(row.qty),
    reference_image_url: row.image_1_url || null,
    image_1_url: row.image_1_url || null,
    assigned_team: row.assigned_team || null,
    is_workflow_complete: row.is_workflow_complete === true,
    is_legacy_workflow: row.is_legacy_workflow === true,
    is_outsourced: row.is_outsourced === true,
    vendor_name: row.vendor_name || null,
    removed_from_latest_ingestion: row.removed_from_latest_ingestion === true,
  };
}

async function loadProjectTruthForNative(user, context, client = pool) {
  const departmentId = resolveNativeDepartmentId(user, context.department_id);
  const projectCode = normalizeProjectCode(context.project_code);

  if (!projectCode) {
    return {
      department_id: departmentId,
      project: null,
      existing: [],
    };
  }

  const hidden = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT p.id
      FROM design.projects p
      WHERE p.project_no = $2
        AND p.department_id = $3
        AND NOT (${visibleProjectPredicate("p")})
      LIMIT 1
    `,
    [user.employee_id, projectCode, departmentId],
  );

  if (hidden.rows.length > 0) {
    throw new AppError(403, "Project is outside your reporting-tree visibility and cannot be ingested natively.");
  }

  const projectResult = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        p.project_name,
        p.customer_name,
        p.department_id,
        p.status
      FROM design.projects p
      WHERE p.project_no = $2
        AND p.department_id = $3
        AND ${visibleProjectPredicate("p")}
      LIMIT 1
    `,
    [user.employee_id, projectCode, departmentId],
  );

  const project = projectResult.rows[0] || null;
  if (!project) {
    return {
      department_id: departmentId,
      project: null,
      existing: [],
    };
  }

  const fixtureResult = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        f.id AS fixture_id,
        f.project_id,
        f.fixture_no,
        f.part_name,
        f.fixture_type,
        f.remark,
        f.qty,
        f.image_1_url,
        f.is_workflow_complete,
        f.is_legacy_workflow,
        f.is_outsourced,
        f.vendor_name,
        f.removed_from_latest_ingestion,
        COALESCE(current_progress.assigned_team, current_progress.assigned_to) AS assigned_team
      FROM design.fixtures f
      JOIN design.projects p
        ON p.id = f.project_id
      LEFT JOIN LATERAL (
        SELECT
          fwp.assigned_to,
          assignee.name AS assigned_team
        FROM fixture_workflow_progress fwp
        LEFT JOIN users assignee
          ON assignee.employee_id = fwp.assigned_to
        WHERE fwp.fixture_id = f.id
          AND fwp.department_id = p.department_id
        ORDER BY
          CASE WHEN fwp.status <> 'APPROVED' THEN 0 ELSE 1 END ASC,
          CASE WHEN fwp.status <> 'APPROVED' THEN fwp.stage_order END ASC NULLS LAST,
          CASE WHEN fwp.status = 'APPROVED' THEN fwp.stage_order END DESC NULLS LAST
        LIMIT 1
      ) current_progress ON TRUE
      WHERE f.project_id = $2
        AND ${visibleFixturePredicate("f", "p")}
    `,
    [user.employee_id, project.project_id],
  );

  return {
    department_id: departmentId,
    project,
    existing: fixtureResult.rows.map(normalizeExistingFixture),
  };
}

function hasIncomingImage(row) {
  return Boolean(collapseWhitespace(row.reference_image_url));
}

function classifyAgainstExisting(row, existing) {
  const partDiff = normalizeComparable(existing.part_name) !== normalizeComparable(row.part_name);
  const typeDiff = normalizeComparable(existing.fixture_type) !== normalizeComparable(row.fixture_type);
  const qtyDiff = Number(existing.qty) !== Number(row.qty);
  const remarkDiff = collapseWhitespace(existing.remark) !== collapseWhitespace(row.remark);
  const outsourcedDiff = existing.is_outsourced !== row.is_outsourced;
  const vendorDiff = normalizeComparable(existing.vendor_name) !== normalizeComparable(row.vendor_name);
  const imageDiff = hasIncomingImage(row)
    && collapseWhitespace(existing.reference_image_url) !== collapseWhitespace(row.reference_image_url);

  return (
    partDiff
    || typeDiff
    || qtyDiff
    || remarkDiff
    || outsourcedDiff
    || vendorDiff
    || imageDiff
    || existing.removed_from_latest_ingestion
  )
    ? "UPDATED"
    : "EXISTING";
}

function buildValidationState(classification, issues) {
  if (issues.length > 0) {
    return issues.map((issue) => issue.message).join(" ");
  }
  if (classification === "NEW") return "Valid new fixture";
  if (classification === "UPDATED") return "Valid fixture update";
  if (classification === "EXISTING") return "Already matches project";
  if (classification === "DUPLICATE") return "Duplicate imported row";
  return "Validated";
}

function buildSummary(rows, truth, context) {
  const presentSet = new Set(
    rows
      .filter((row) => row.severity !== "error" && row.incoming?.fixture_no)
      .map((row) => normalizeFixtureNo(row.incoming.fixture_no).toLowerCase()),
  );
  const deletedFixtureNos = context.upload_mode === "full_project_update"
    ? truth.existing
      .filter((fixture) => !fixture.removed_from_latest_ingestion)
      .filter((fixture) => !presentSet.has(fixture.canonical_fixture_no.toLowerCase()))
      .map((fixture) => fixture.fixture_no)
    : [];

  return rows.reduce((acc, row) => {
    acc.total_rows += 1;
    acc.by_classification[row.classification] = (acc.by_classification[row.classification] || 0) + 1;
    if (row.classification === "DUPLICATE") {
      acc.duplicate_rows += 1;
    }
    if (row.severity === "error") {
      acc.invalid_rows += 1;
    } else {
      acc.valid_rows += 1;
      if (row.classification === "NEW") {
        acc.new_fixture_nos.push(row.incoming.fixture_no);
      }
      if (row.classification === "UPDATED") {
        acc.modified_fixture_nos.push(row.incoming.fixture_no);
      }
    }
    return acc;
  }, {
    total_rows: 0,
    by_classification: {},
    valid_rows: 0,
    invalid_rows: 0,
    duplicate_rows: 0,
    deleted_fixture_nos: deletedFixtureNos,
    modified_fixture_nos: [],
    new_fixture_nos: [],
  });
}

async function validateNativeRows(user, payload = {}, client = pool) {
  const context = normalizeNativeContext(payload.context || {}, user);
  const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
  const truth = await loadProjectTruthForNative(user, context, client);
  const existingByFixtureNo = new Map();
  truth.existing.forEach((fixture) => {
    existingByFixtureNo.set(fixture.canonical_fixture_no.toLowerCase(), fixture);
  });

  const normalizedRows = rawRows
    .map((row, index) => ({ originalIndex: index, row: normalizeNativeRow(row, index) }))
    .filter(({ row }) => !isEmptyNativeRow(row.raw));

  const countsByFixture = new Map();
  normalizedRows.forEach(({ row }) => {
    const key = row.fixture_no.toLowerCase();
    if (!key) {
      return;
    }
    countsByFixture.set(key, (countsByFixture.get(key) || 0) + 1);
  });

  const validationRows = normalizedRows.map(({ row, originalIndex }) => {
    const issues = [];
    let classification = "NEW";
    const key = row.fixture_no.toLowerCase();

    if (!context.project_code || !context.project_name || !context.customer_name) {
      addIssue(
        issues,
        ISSUE_SEVERITY.ERROR,
        "project_identity_required",
        "Project identity must include Project Number, Project Name, and Customer Name.",
        ["validation_state"],
      );
    }
    if (!row.fixture_no) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "fixture_no_required", "Fixture No is required.", ["fixture_no"]);
    }
    if (!row.part_name) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "part_name_required", "Part Name is required.", ["part_name"]);
    }
    if (!row.fixture_type) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "fixture_type_required", "Fixture Type is required.", ["fixture_type"]);
    }
    if (row.qty === null) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "qty_invalid", "Qty must be a positive whole number.", ["qty"]);
    }
    if (!isValidImageReference(row.reference_image_url)) {
      addIssue(
        issues,
        ISSUE_SEVERITY.ERROR,
        "image_malformed",
        "Reference Image must be a URL, local staged upload path, or image data URL.",
        ["reference_image_url"],
      );
    }
    if (row.is_outsourced && !row.vendor_name) {
      addIssue(
        issues,
        ISSUE_SEVERITY.ERROR,
        "outsourced_vendor_required",
        "Vendor is required when Outsourced is checked.",
        ["vendor_name"],
      );
    }
    if (key && countsByFixture.get(key) > 1) {
      classification = "DUPLICATE";
      addIssue(
        issues,
        ISSUE_SEVERITY.ERROR,
        "duplicate_imported_row",
        "Duplicate Fixture No exists in this import.",
        ["fixture_no"],
      );
    }

    const hasHardError = issues.some((issue) => issue.severity === ISSUE_SEVERITY.ERROR);
    const existing = key ? existingByFixtureNo.get(key) || null : null;
    if (!hasHardError && classification !== "DUPLICATE") {
      classification = existing ? classifyAgainstExisting(row, existing) : "NEW";
    }

    const severity = hasHardError
      ? "error"
      : issues.length > 0
        ? "warning"
        : "safe";

    const normalized = {
      fixture_no: row.fixture_no,
      part_name: row.part_name,
      fixture_type: row.fixture_type,
      remark: row.remark,
      qty: row.qty,
      is_outsourced: row.is_outsourced,
      vendor_name: row.vendor_name,
      reference_image_url: row.reference_image_url,
      image_1_url: row.reference_image_url,
      image_2_url: null,
    };

    return {
      row_id: row.row_id,
      row_number: row.row_number,
      original_index: originalIndex,
      classification,
      severity,
      status: classification,
      assigned_team: existing?.assigned_team || null,
      validation_state: buildValidationState(classification, issues),
      cell_states: cellStateFromIssues(issues),
      issues,
      normalized,
      incoming: {
        row_id: row.row_id,
        row_number: row.row_number,
        ...normalized,
        assigned_team: existing?.assigned_team || null,
        image_storage: row.image_storage,
        raw_data: row.raw,
      },
      existing,
    };
  });

  return {
    context: {
      ...context,
      department_id: truth.department_id,
    },
    project: truth.project,
    rows: validationRows,
    summary: buildSummary(validationRows, truth, context),
  };
}

module.exports = {
  ISSUE_SEVERITY,
  loadProjectTruthForNative,
  resolveNativeDepartmentId,
  validateNativeRows,
};
