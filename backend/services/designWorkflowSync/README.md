# Design workflow truth synchronization (operational layer)

Spreadsheet ingestion is **catalog metadata** input. Workflow execution truth (stages, assignments, approvals, proofs, verification, contributor history, revision history) lives in operational tables and must never be overwritten by ingestion merges.

## Transaction strategy

`BEGIN` → `getActiveWorkflowForDepartment` → project upsert → `createUploadBatch` → **`synchronizeDesignWorkflowTruthFromIngestion`** → upload errors / corrections audit → `COMMIT` → `markIngestionSessionCommitted`.

Inside the sync function:

1. `SELECT … FROM design.fixtures WHERE project_id = $1 FOR UPDATE` (row lock set).
2. Load fixture rows for merge.
3. Bulk `INSERT` new fixtures (batched).
4. `bulkInitProgressForFixtures` for new ids only (`ON CONFLICT DO NOTHING` on `fixture_workflow_progress`).
5. Bulk `UPDATE` only merge-contract columns on existing fixtures (batched `VALUES` join).
6. Optional **full catalog** soft lifecycle: clear `removed_from_latest_ingestion` for fixtures present in the sheet; set flags for fixtures absent from the sheet (never `DELETE`).
7. **`assertPostIngestionWorkflowIntegrity`** — throws → outer `ROLLBACK` (no partial truth).

## Catalog membership modes

- `delta` (default): ingestion rows update/create fixtures; fixtures omitted from the upload are **unchanged** (no soft archival).
- `full_replace`: ingestion row set is treated as the authoritative membership list for **catalog presence**; omitted fixtures are soft-marked `removed_from_latest_ingestion` (workflow rows and tasks stay intact).

Set via preview payload `catalog_membership_mode: "full_replace"` (stored on `design.ingestion_sessions.snapshot`).

## Files

- `services/designWorkflowSync/mergeContract.js` — merge contract constants.
- `services/designWorkflowSync/canonicalIdentity.js` — canonical key helpers.
- `services/designWorkflowSync/ingestionIntegrity.js` — post-commit integrity checks (same transaction).
- `services/designWorkflowSync/workflowTruthSynchronizationService.js` — orchestration.
- `repositories/designFixtureWorkflowSyncRepository.js` — batched SQL.
- `repositories/designSchemaRepository.js` — archival + outsourcing columns on `design.fixtures`.
- `services/designIngestion/normalize.js` — centralized canonical fixture number rules.
- `services/designExcelService.js` — wires transactional commit to the sync engine.
