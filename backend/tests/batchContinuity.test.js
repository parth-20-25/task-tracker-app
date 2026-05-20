const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/tasktracker_test';

const { pool } = require('../db');
const {
  upsertProjectByNumber,
  createUploadBatch,
} = require('../repositories/designProjectCatalogRepository');
const { listBatchesWithSummary } = require('../repositories/batchRepository');

test('createUploadBatch reuses active batch and listing shows one project row', async () => {
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');

    const projectNo = `TEST-P-${Date.now()}`;
    const project = await upsertProjectByNumber({
      project_no: projectNo,
      project_name: 'Batch continuity test',
      customer_name: 'TestCo',
      department_id: 'design',
      uploaded_by: 'tester',
    }, conn);

    // First upload
    const batchA = await createUploadBatch({
      project_id: project.project_id,
      uploaded_by: 'tester',
      uploaded_by_user_id: 'tester',
      total_rows: 3,
      accepted_rows: 3,
      rejected_rows: 0,
    }, conn);

    // Second upload for same project should reuse the active batch id
    const batchB = await createUploadBatch({
      project_id: project.project_id,
      uploaded_by: 'tester',
      uploaded_by_user_id: 'tester',
      total_rows: 2,
      accepted_rows: 2,
      rejected_rows: 0,
    }, conn);

    assert.equal(batchA, batchB, 'Expected same operational batch id on reupload');

    // Listing batches within same transaction should show one row for this project
    const summaries = await listBatchesWithSummary(null, conn);
    const matching = summaries.filter((r) => r.project_no === projectNo);
    assert.equal(matching.length, 1, 'Expected exactly one visible batch row for the project');

    await conn.query('ROLLBACK');
  } finally {
    conn.release();
  }
});
