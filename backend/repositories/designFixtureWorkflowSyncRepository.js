const { instrumentModuleExports } = require("../lib/observability");

const CHUNK_SIZE = 80;

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Row-level lock on all fixtures for the project so membership / merge commits stay atomic vs concurrent writers.
 */
async function lockDesignProjectFixtures(projectId, client) {
  await client.query(
    `SELECT 1 FROM design.fixtures WHERE project_id = $1::uuid FOR UPDATE`,
    [projectId],
  );
}

async function loadDesignFixturesForIngestionMerge(projectId, client) {
  const res = await client.query(
    `
      SELECT
        id,
        fixture_no,
        part_name,
        fixture_type,
        remark,
        qty,
        image_1_url,
        image_2_url,
        is_outsourced,
        vendor_name,
        outsourced_at,
        outsourced_by,
        removed_from_latest_ingestion
      FROM design.fixtures
      WHERE project_id = $1::uuid
    `,
    [projectId],
  );
  return res.rows;
}

async function bulkInsertIngestionFixtures(rows, client) {
  if (!rows.length) {
    return [];
  }
  const inserted = [];
  for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
    const placeholders = [];
    const params = [];
    let i = 1;
    for (const r of chunk) {
      placeholders.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
      );
      params.push(
        r.project_id,
        r.fixture_no,
        r.part_name,
        r.fixture_type,
        r.remark,
        r.qty,
        r.image_1_url,
        r.image_2_url,
        r.ingestion_source,
        r.batch_id,
        r.is_outsourced,
        r.vendor_name,
        r.outsourced_at,
        r.outsourced_by,
      );
    }
    const sql = `
      INSERT INTO design.fixtures (
        project_id,
        fixture_no,
        part_name,
        fixture_type,
        remark,
        qty,
        image_1_url,
        image_2_url,
        ingestion_source,
        batch_id,
        is_outsourced,
        vendor_name,
        outsourced_at,
        outsourced_by
      )
      VALUES ${placeholders.join(",\n")}
      RETURNING id, fixture_no
    `;
    const res = await client.query(sql, params);
    inserted.push(...res.rows);
  }
  return inserted;
}

async function bulkUpdateIngestionSafeFixtureFields(rows, projectId, client) {
  if (!rows.length) {
    return;
  }
  for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
    const placeholders = [];
    const params = [projectId];
    let i = 2;
    for (const r of chunk) {
      placeholders.push(
        `($${i++}::text, $${i++}::text, $${i++}::text, $${i++}::int, $${i++}::text, $${i++}::text, $${i++}::text, $${i++}::text, $${i++}::text, $${i++}::boolean, $${i++}::text, $${i++}::timestamptz, $${i++}::varchar)`,
      );
      params.push(
        r.fixture_no,
        r.part_name,
        r.fixture_type,
        r.qty,
        r.remark,
        r.image_1_url,
        r.image_2_url,
        r.ingestion_source,
        r.batch_id,
        r.is_outsourced,
        r.vendor_name,
        r.outsourced_at,
        r.outsourced_by,
      );
    }
    const sql = `
      UPDATE design.fixtures AS f
      SET
        part_name = v.part_name,
        fixture_type = v.fixture_type,
        qty = v.qty,
        remark = v.remark,
        image_1_url = v.image_1_url,
        image_2_url = v.image_2_url,
        ingestion_source = v.ingestion_source,
        batch_id = v.batch_id::uuid,
        is_outsourced = v.is_outsourced,
        vendor_name = v.vendor_name,
        outsourced_at = v.outsourced_at,
        outsourced_by = v.outsourced_by,
        updated_at = NOW()
      FROM (
        VALUES ${placeholders.join(",\n")}
      ) AS v(
        fixture_no,
        part_name,
        fixture_type,
        qty,
        remark,
        image_1_url,
        image_2_url,
        ingestion_source,
        batch_id,
        is_outsourced,
        vendor_name,
        outsourced_at,
        outsourced_by
      )
      WHERE f.project_id = $1::uuid
        AND f.fixture_no = v.fixture_no
    `;
    await client.query(sql, params);
  }
}

/**
 * Fixtures present again in a full-catalog ingestion clear soft-removal markers (no deletion).
 */
async function clearIngestionRemovalMarkersForPresentFixtures(projectId, fixtureNos, client) {
  if (!fixtureNos.length) {
    return 0;
  }
  const res = await client.query(
    `
      UPDATE design.fixtures
      SET removed_from_latest_ingestion = FALSE,
          ingestion_archived_at = NULL,
          updated_at = NOW()
      WHERE project_id = $1::uuid
        AND fixture_no = ANY($2::text[])
        AND removed_from_latest_ingestion = TRUE
    `,
    [projectId, fixtureNos],
  );
  return res.rowCount || 0;
}

/**
 * Mark fixtures missing from this ingestion snapshot (full_replace only). Never deletes rows.
 */
async function markFixturesRemovedFromLatestIngestion(projectId, presentFixtureNos, client) {
  const present = presentFixtureNos.length ? presentFixtureNos : [""];
  const res = await client.query(
    `
      UPDATE design.fixtures
      SET removed_from_latest_ingestion = TRUE,
          ingestion_archived_at = NOW(),
          updated_at = NOW()
      WHERE project_id = $1::uuid
        AND NOT (fixture_no = ANY($2::text[]))
        AND removed_from_latest_ingestion = FALSE
    `,
    [projectId, present],
  );
  return res.rowCount || 0;
}

module.exports = instrumentModuleExports("repository.designFixtureWorkflowSyncRepository", {
  lockDesignProjectFixtures,
  loadDesignFixturesForIngestionMerge,
  bulkInsertIngestionFixtures,
  bulkUpdateIngestionSafeFixtureFields,
  clearIngestionRemovalMarkersForPresentFixtures,
  markFixturesRemovedFromLatestIngestion,
});
