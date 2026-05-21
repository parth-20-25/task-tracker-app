const { AppError } = require("../../lib/AppError");
const { requireUserDepartment, resolveAccessibleDepartmentId } = require("../../lib/departmentContext");
const { pool } = require("../../db");
const {
  buildVisibleUsersCte,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("../../repositories/projectVisibility");
const {
  FIXTURE_NO_PATTERN,
  collapseWhitespace,
  isEmptyNativeRow,
  normalizeComparable,
  normalizeFixtureNo,
  normalizeNativeContext,
  normalizeNativeRow,
} = require("./normalization");

const ISSUE_SEVERITY = Object.freeze({
  ERROR: "error",
  WARNING: "warning",
  CONFLICT: "conflict",
});

function resolveNativeDepartmentId(user, requestedDepartmentId) {
  const departmentId = collapseWhitespace(requestedDepartmentId);
  if (departmentId) {
    return resolveAccessibleDepartmentId(user, departmentId, "Invalid native ingestion department context");
  }
  return requireUserDepartment(user);
}

function cellStateFromIssues(issues) {
  const cellStates = {};
  for (const issue of issues) {
    for (const column of issue.columns || []) {
      const existing = cellStates[column];
      if (existing === "error") {
        continue;
      }
      if (issue.severity === ISSUE_SEVERITY.ERROR) {
        cellStates[column] = "error";
      } else if (issue.severity === ISSUE_SEVERITY.CONFLICT && existing !== "error") {
        cellStates[column] = "conflict";
      } else if (!existing) {
        cellStates[column] = "warning";
      }
    }
  }
  return cellStates;
}

function addIssue(issues, severity, code, message, columns = []) {
  issues.push({ severity, code, message, columns });
}

function existingImageDiff(existingValue, incomingValue) {
  const incoming = collapseWhitespace(incomingValue);
  if (!incoming) {
    return false;
  }
  return collapseWhitespace(existingValue) !== incoming;
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
    image_1_url: row.image_1_url || null,
    image_2_url: row.image_2_url || null,
    revision_no: Number(row.revision_no || 0),
    is_workflow_complete: row.is_workflow_complete === true,
    is_legacy_workflow: row.is_legacy_workflow === true,
    is_outsourced: row.is_outsourced === true,
    vendor_name: row.vendor_name || null,
    removed_from_latest_ingestion: row.removed_from_latest_ingestion === true,
  };
}

async function loadProjectTruthForNative(user, context, client = pool) {
  const departmentId = resolveNativeDepartmentId(user, context.department_id);
  const projectNo = normalizeFixtureNo(context.project_no);

  if (!projectNo) {
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
    [user.employee_id, projectNo, departmentId],
  );

  if (hidden.rows.length > 0) {
    throw new AppError(403, "Project No is outside your reporting-tree visibility and cannot be ingested natively.");
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
    [user.employee_id, projectNo, departmentId],
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
        f.image_2_url,
        f.revision_no,
        f.is_workflow_complete,
        f.is_legacy_workflow,
        f.is_outsourced,
        f.vendor_name,
        f.removed_from_latest_ingestion
      FROM design.fixtures f
      JOIN design.projects p
        ON p.id = f.project_id
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

function classifyAgainstExisting(row, existing, context, issues) {
  const partDiff = normalizeComparable(existing.part_name) !== normalizeComparable(row.part_name);
  const typeDiff = normalizeComparable(existing.fixture_type) !== normalizeComparable(row.fixture_type);
  const qtyDiff = Number(existing.qty) !== Number(row.qty);
  const remarkDiff = collapseWhitespace(existing.remark) !== collapseWhitespace(row.remark);
  const outsourcedDiff = existing.is_outsourced !== row.is_outsourced;
  const vendorDiff = normalizeComparable(existing.vendor_name) !== normalizeComparable(row.vendor_name);
  const image1Diff = existingImageDiff(existing.image_1_url, row.image_1_url);
  const image2Diff = existingImageDiff(existing.image_2_url, row.image_2_url);
  const revisionNo = Number.isFinite(Number(context.revision_no)) ? Number(context.revision_no) : null;
  const incomingChangesDefinition = partDiff || typeDiff || image1Diff || image2Diff;

  if (revisionNo !== null && existing.revision_no > revisionNo) {
    addIssue(
      issues,
      ISSUE_SEVERITY.CONFLICT,
      "conflicting_revision",
      `Existing fixture revision ${existing.revision_no} is newer than workspace revision ${revisionNo}.`,
      ["validation_state"],
    );
  }

  if (incomingChangesDefinition && existing.is_workflow_complete) {
    addIssue(
      issues,
      ISSUE_SEVERITY.CONFLICT,
      "unsafe_completed_fixture_update",
      "Definition/image update targets a workflow-complete fixture and requires explicit resolution.",
      ["part_name", "fixture_type", "image_1_url", "image_2_url"],
    );
  }

  if (partDiff) {
    addIssue(issues, ISSUE_SEVERITY.CONFLICT, "part_name_conflict", "Existing part name differs from incoming row.", ["part_name"]);
  }
  if (typeDiff) {
    addIssue(issues, ISSUE_SEVERITY.CONFLICT, "fixture_type_conflict", "Existing fixture type differs from incoming row.", ["fixture_type"]);
  }
  if (image1Diff) {
    addIssue(issues, ISSUE_SEVERITY.CONFLICT, "image_1_conflict", "Existing Image 1 differs from incoming row.", ["image_1_url"]);
  }
  if (image2Diff) {
    addIssue(issues, ISSUE_SEVERITY.CONFLICT, "image_2_conflict", "Existing Image 2 differs from incoming row.", ["image_2_url"]);
  }

  const hasConflict = issues.some((issue) => issue.severity === ISSUE_SEVERITY.CONFLICT);
  if (hasConflict) {
    return "CONFLICT";
  }

  if (qtyDiff || remarkDiff || outsourcedDiff || vendorDiff) {
    return "UPDATED";
  }

  return "EXISTING";
}

function buildValidationState(classification, issues) {
  if (issues.length === 0) {
    if (classification === "NEW") return "Safe to create";
    if (classification === "UPDATED") return "Safe metadata update";
    if (classification === "EXISTING") return "No production change";
    return "Validated";
  }

  return issues.map((issue) => issue.message).join(" ");
}

function buildSummary(rows) {
  return rows.reduce((acc, row) => {
    acc.total_rows += 1;
    acc.by_classification[row.classification] = (acc.by_classification[row.classification] || 0) + 1;
    if (row.severity === "error") acc.error_rows += 1;
    if (row.severity === "warning") acc.warning_rows += 1;
    if (row.severity === "conflict") acc.conflict_rows += 1;
    return acc;
  }, {
    total_rows: 0,
    by_classification: {},
    error_rows: 0,
    warning_rows: 0,
    conflict_rows: 0,
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

    if (!context.project_no) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "project_no_required", "Project No is required before validation.", ["validation_state"]);
    }
    if (!context.customer) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "customer_required", "Customer is required before validation.", ["validation_state"]);
    }
    if (!row.fixture_no) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "fixture_no_required", "Fixture No is required.", ["fixture_no"]);
    } else if (!FIXTURE_NO_PATTERN.test(row.fixture_no)) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "fixture_no_malformed", "Fixture No must match PARC followed by at least three digits.", ["fixture_no"]);
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
    if (row.is_outsourced && !row.vendor_name) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "outsourced_vendor_required", "Vendor is required when Outsourced is checked.", ["vendor_name"]);
    }
    if (!row.is_outsourced && row.vendor_name) {
      addIssue(issues, ISSUE_SEVERITY.ERROR, "vendor_without_outsourcing", "Vendor must be empty when Outsourced is unchecked.", ["vendor_name", "is_outsourced"]);
    }
    if (key && countsByFixture.get(key) > 1) {
      classification = "DUPLICATE";
      addIssue(
        issues,
        ISSUE_SEVERITY.ERROR,
        "duplicate_fixture",
        "Duplicate normalized Fixture No exists in this ingestion session.",
        ["fixture_no"],
      );
    }

    const hasHardError = issues.some((issue) => issue.severity === ISSUE_SEVERITY.ERROR);
    const existing = key ? existingByFixtureNo.get(key) || null : null;
    if (!hasHardError && classification !== "DUPLICATE") {
      classification = existing ? classifyAgainstExisting(row, existing, context, issues) : "NEW";
    }

    const hasConflict = issues.some((issue) => issue.severity === ISSUE_SEVERITY.CONFLICT);
    const severity = hasHardError
      ? "error"
      : hasConflict
        ? "conflict"
        : issues.length > 0
          ? "warning"
          : "safe";

    return {
      row_id: row.row_id,
      row_number: row.row_number,
      original_index: originalIndex,
      classification,
      severity,
      status: classification,
      validation_state: buildValidationState(classification, issues),
      cell_states: cellStateFromIssues(issues),
      issues,
      normalized: {
        fixture_no: row.fixture_no,
        part_name: row.part_name,
        fixture_type: row.fixture_type,
        remark: row.remark,
        qty: row.qty,
        is_outsourced: row.is_outsourced,
        vendor_name: row.vendor_name,
        image_1_url: row.image_1_url,
        image_2_url: row.image_2_url,
      },
      incoming: {
        row_id: row.row_id,
        row_number: row.row_number,
        fixture_no: row.fixture_no,
        part_name: row.part_name,
        fixture_type: row.fixture_type,
        remark: row.remark,
        qty: row.qty,
        is_outsourced: row.is_outsourced,
        vendor_name: row.vendor_name,
        image_1_url: row.image_1_url,
        image_2_url: row.image_2_url,
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
    conflicts: validationRows.filter((row) => row.classification === "CONFLICT"),
    summary: buildSummary(validationRows),
  };
}

module.exports = {
  ISSUE_SEVERITY,
  loadProjectTruthForNative,
  resolveNativeDepartmentId,
  validateNativeRows,
};
