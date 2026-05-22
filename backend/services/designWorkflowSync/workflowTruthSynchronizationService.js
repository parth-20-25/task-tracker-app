const { AppError } = require("../../lib/AppError");
const { collapseWhitespaceTrim } = require("../designIngestion/normalize");
const { fixtureCanonicalKey, canonicalFixtureNo } = require("./canonicalIdentity");
const { CATALOG_MEMBERSHIP_MODES } = require("./mergeContract");
const { assertPostIngestionWorkflowIntegrity } = require("./ingestionIntegrity");
const {
  lockDesignProjectFixtures,
  loadDesignFixturesForIngestionMerge,
  bulkInsertIngestionFixtures,
  bulkUpdateIngestionSafeFixtureFields,
  clearIngestionRemovalMarkersForPresentFixtures,
  markFixturesRemovedFromLatestIngestion,
} = require("../../repositories/designFixtureWorkflowSyncRepository");
const { bulkInitProgressForFixtures } = require("../../repositories/fixtureWorkflowRepository");

function parseOptionalBoolean(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const s = String(value).trim().toLowerCase();
  if (["y", "yes", "true", "1", "x"].includes(s)) {
    return true;
  }
  if (["n", "no", "false", "0"].includes(s)) {
    return false;
  }
  return undefined;
}

function deriveOutsourcingState(incoming, existingRow, employeeId) {
  const rawFlag = parseOptionalBoolean(incoming.is_outsourced);
  if (rawFlag === undefined) {
    return {
      touched: false,
      is_outsourced: existingRow.is_outsourced === true,
      vendor_name: existingRow.vendor_name || null,
      outsourced_at: existingRow.outsourced_at || null,
      outsourced_by: existingRow.outsourced_by || null,
    };
  }

  const vendorRaw = incoming.vendor_name ?? incoming.vendor ?? "";
  const vendor = collapseWhitespaceTrim(vendorRaw) || null;

  if (rawFlag === true) {
    if (!vendor) {
      throw new AppError(
        400,
        `vendor_name is required when is_outsourced is true (fixture ${canonicalFixtureNo(incoming.fixture_no)}).`,
      );
    }
    return {
      touched: true,
      is_outsourced: true,
      vendor_name: vendor,
      outsourced_at: existingRow.outsourced_at || new Date(),
      outsourced_by: existingRow.outsourced_by || employeeId,
    };
  }

  return {
    touched: true,
    is_outsourced: false,
    vendor_name: null,
    outsourced_at: null,
    outsourced_by: null,
  };
}

function mergeImages(incoming, existing) {
  const referenceImage = incoming.reference_image_url || incoming.image_1_url || null;
  return {
    image_1_url: referenceImage || existing.image_1_url || null,
    image_2_url: existing.image_2_url || null,
  };
}

function resolveRemark(incoming, existing) {
  if (incoming.remark !== undefined && incoming.remark !== null && String(incoming.remark).trim() !== "") {
    return collapseWhitespaceTrim(incoming.remark);
  }
  return existing.remark ?? null;
}

function comparable(value) {
  return collapseWhitespaceTrim(value).toLowerCase();
}

function nullableText(value) {
  const normalized = collapseWhitespaceTrim(value);
  return normalized || null;
}

function safeFieldChanged(next, existing) {
  return comparable(next.part_name) !== comparable(existing.part_name)
    || comparable(next.fixture_type) !== comparable(existing.fixture_type)
    || Number(next.qty) !== Number(existing.qty)
    || nullableText(next.remark) !== nullableText(existing.remark)
    || nullableText(next.image_1_url) !== nullableText(existing.image_1_url)
    || nullableText(next.image_2_url) !== nullableText(existing.image_2_url)
    || next.is_outsourced !== (existing.is_outsourced === true)
    || nullableText(next.vendor_name) !== nullableText(existing.vendor_name)
    || existing.removed_from_latest_ingestion === true;
}

/**
 * Pipeline: lock → load workflow truth → safe merge (metadata only) → optional catalog soft-removal
 * → integrity assertions (same transaction).
 *
 * Does not touch tasks, progress content, attempts, revisions, or proofs — only design.fixtures catalog fields
 * and inserts PENDING progress shells for brand-new fixtures.
 */
async function synchronizeDesignWorkflowTruthFromIngestion(client, params) {
  const {
    projectId,
    batchId,
    departmentId,
    employeeId,
    ingestionSource,
    promotedFixtureRows,
    workflowStages,
    catalogMembershipMode,
  } = params;

  if (catalogMembershipMode === CATALOG_MEMBERSHIP_MODES.FULL_REPLACE && promotedFixtureRows.length === 0) {
    throw new AppError(400, "Catalog full_replace mode requires at least one fixture in the ingestion batch.");
  }

  await lockDesignProjectFixtures(projectId, client);

  const dbRows = await loadDesignFixturesForIngestionMerge(projectId, client);
  const byKey = new Map();
  for (const row of dbRows) {
    byKey.set(fixtureCanonicalKey(row.fixture_no), row);
  }

  const presentCanonicalNos = [];
  const presentKeySet = new Set();

  const rowsToInsert = [];
  const rowsToUpdate = [];

  const audit = {
    created_fixture_ids: [],
    created_fixture_nos: [],
    updated_fixture_nos: [],
    archived_fixture_nos: [],
    unchanged_fixture_nos: [],
    revived_fixture_count: 0,
    outsourcing_rows_touched: 0,
  };

  for (const raw of promotedFixtureRows) {
    const canonicalNo = canonicalFixtureNo(raw.fixture_no);
    if (!presentKeySet.has(canonicalNo.toLowerCase())) {
      presentKeySet.add(canonicalNo.toLowerCase());
      presentCanonicalNos.push(canonicalNo);
    }

    const key = fixtureCanonicalKey(canonicalNo);
    const existing = byKey.get(key);

    if (!existing) {
      const os = deriveOutsourcingState(
        raw,
        { is_outsourced: false, vendor_name: null, outsourced_at: null, outsourced_by: null },
        employeeId,
      );
      if (os.touched) {
        audit.outsourcing_rows_touched += 1;
      }
      rowsToInsert.push({
        project_id: projectId,
        fixture_no: canonicalNo,
        part_name: raw.part_name,
        fixture_type: raw.fixture_type,
        remark: resolveRemark(raw, { remark: null }),
        qty: raw.qty,
        image_1_url: raw.reference_image_url || raw.image_1_url || null,
        image_2_url: null,
        ingestion_source: ingestionSource,
        batch_id: batchId,
        is_outsourced: os.is_outsourced,
        vendor_name: os.vendor_name,
        outsourced_at: os.is_outsourced ? (os.outsourced_at || new Date()) : null,
        outsourced_by: os.is_outsourced ? employeeId : null,
      });
      continue;
    }

    const images = mergeImages(raw, existing);
    const os = deriveOutsourcingState(raw, existing, employeeId);
    if (os.touched) {
      audit.outsourcing_rows_touched += 1;
    }

    let outsourced_at = existing.outsourced_at;
    let outsourced_by = existing.outsourced_by;
    if (os.touched) {
      if (os.is_outsourced) {
        outsourced_at = os.outsourced_at;
        outsourced_by = os.outsourced_by;
      } else {
        outsourced_at = null;
        outsourced_by = null;
      }
    }

    const nextUpdate = {
      fixture_no: canonicalNo,
      part_name: raw.part_name,
      fixture_type: raw.fixture_type,
      remark: resolveRemark(raw, existing),
      qty: raw.qty,
      image_1_url: images.image_1_url,
      image_2_url: images.image_2_url,
      ingestion_source: ingestionSource,
      batch_id: batchId,
      is_outsourced: os.touched ? os.is_outsourced : existing.is_outsourced,
      vendor_name: os.touched ? os.vendor_name : existing.vendor_name,
      outsourced_at: os.touched ? outsourced_at : existing.outsourced_at,
      outsourced_by: os.touched ? outsourced_by : existing.outsourced_by,
    };

    if (safeFieldChanged(nextUpdate, existing)) {
      rowsToUpdate.push(nextUpdate);
    } else {
      audit.unchanged_fixture_nos.push(canonicalNo);
    }
  }

  const inserted = await bulkInsertIngestionFixtures(rowsToInsert, client);
  for (const row of inserted) {
    audit.created_fixture_ids.push(row.id);
    audit.created_fixture_nos.push(row.fixture_no);
  }

  if (inserted.length && workflowStages?.length) {
    await bulkInitProgressForFixtures(
      inserted.map((r) => r.id),
      departmentId,
      workflowStages,
      client,
    );
  }

  if (rowsToUpdate.length) {
    await bulkUpdateIngestionSafeFixtureFields(rowsToUpdate, projectId, client);
    audit.updated_fixture_nos = rowsToUpdate.map((r) => r.fixture_no);
  }

  if (catalogMembershipMode === CATALOG_MEMBERSHIP_MODES.FULL_REPLACE) {
    const presentSet = new Set(presentCanonicalNos.map((n) => n.toLowerCase()));
    const plannedArchive = dbRows
      .filter((r) => !presentSet.has(fixtureCanonicalKey(r.fixture_no)) && r.removed_from_latest_ingestion !== true)
      .map((r) => r.fixture_no);

    audit.revived_fixture_count = await clearIngestionRemovalMarkersForPresentFixtures(
      projectId,
      presentCanonicalNos,
      client,
    );

    await markFixturesRemovedFromLatestIngestion(projectId, presentCanonicalNos, client);
    audit.archived_fixture_nos = plannedArchive;
  }

  await assertPostIngestionWorkflowIntegrity(client, { projectId, departmentId });

  return audit;
}

module.exports = {
  synchronizeDesignWorkflowTruthFromIngestion,
  CATALOG_MEMBERSHIP_MODES,
};
