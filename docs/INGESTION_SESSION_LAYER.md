# Design spreadsheet ingestion — session layer (transaction-safe)

This document describes the **ingestion-only** subsystem added for draft sessions, full-grid validation, normalization, conflict classification, transactional commit, and staged images.

## 1. Ingestion session architecture

- **Draft session (`design.ingestion_sessions`)**  
  Created at **preview** time (Excel or paste). Holds `file_info`, `snapshot` (metadata + `staging_object_paths`), TTL (`expires_at`), and transitions `draft` → `committed` (with `committed_batch_id`) after a successful DB commit.
- **Pipeline (no production writes until commit)**  
  `Spreadsheet → Parse/Extract → Staging images (optional) → validateParsedData → diffWithDatabase → formatPreview → persist session snapshot`.
- **Commit** requires `ingestion_session_id` and re-validates **all** incoming rows on the server against **current** production fixtures before opening the DB transaction.

## 2. Transaction strategy

- **Single PostgreSQL transaction** (`BEGIN`/`COMMIT`/`ROLLBACK`) wraps: project upsert, **operational batch continuity** (`createUploadBatch`), per-fixture `upsertFixture`, workflow init, upload errors, corrections, audits.
- **Pre-commit**: server rebuilds **fresh** diff from `resolved_items` incoming rows + live DB; rejects tampered or stale decision sets (count + fixture keys).
- **On DB failure**: `ROLLBACK` + **delete promoted production image objects** created during this commit attempt (best-effort via `deleteStorageObjects`).

## 3. Validation pipeline

- **`validateParsedData`** (all rows, single pass): row-level errors accumulated; duplicate fixture numbers in-sheet; missing/invalid PARC fixture no; required fields; **invalid qty**; **vague vendor/outsourced-only fixture type** (`vendor_fixture_type_vague`).
- **Commit**: incoming payloads re-run `validateParsedData`; any rejected row aborts with `details.rejected_rows` (full grid, not first-error-only).

## 4. Normalization rules (`designIngestion/normalize.js` + validator)

- **fixture_no**: trim, collapse whitespace, remove internal spaces, strip trailing `_`, **uppercase** (`canonicalFixtureNo`).
- **part_name / fixture_type**: trim + internal whitespace collapse; **case-insensitive comparison** in diff (`normalizeComparableText`).
- Prevents `PARC001`, `parc001`, `PARC001_` diverging as identities.

## 5. Conflict / row classification (backend-only)

Each validated row is classified **before commit** using `diffWithDatabase` + `formatPreview`:

| classification | source |
|------------------|--------|
| **NEW** | No matching production row (by canonical fixture no). |
| **EXISTING** | `UNCHANGED` — production row matches incoming. |
| **UPDATED** | `UPDATE_QTY` — only quantity change, compatible images/types/part. |
| **DUPLICATE** | In-sheet duplicate fixture (`duplicate_fixture_no`). |
| **CONFLICT** | Part name / images / other multi-field mismatch vs production. |
| **INVALID** | Validation failure (non-duplicate). |
| **SKIPPED** | Parser skipped row object. |

Legacy diff `type` values (`NEW`, `UPDATE_QTY`, `CONFLICT_*`, `UNCHANGED`) remain for API compatibility; `classification` is the unified label.

## 6. Rollback behavior

- **DB**: explicit `ROLLBACK` on any error inside `confirmUpload` transaction.
- **Images**: embedded Excel images upload to **`design-ingestion-staging/{sessionId}/...`** at preview; **promoted** to `design-excel/...` only after validation passes and **before** `BEGIN`. Staging objects removed on successful promote. If the DB transaction fails after promotion, **new production files** for that attempt are deleted from the cleanup list.

## 7. Image lifecycle

1. **Preview**: `uploadExtractedDesignImageStaging` → public URL + `raw_data.image_storage.*.staging: true` + path tracked in `snapshot.staging_object_paths`.
2. **Commit (incoming rows)**: `promoteStagedExtractedDesignImage` (download → upload final → delete staging object).
3. **Promotion failure**: delete any partial **production** uploads accumulated in `productionPathsForCleanup`.
4. **Post-commit reference images** (`/design/fixtures/:id/reference-image`): unchanged; still direct upload after fixture exists.

## 8. Batch continuity

Unchanged: `createUploadBatch` continues to **reuse the earliest batch** per `project_id` and increment counters — no new batch identity per upload when one already exists.

## 9. Files changed

| Area | Files |
|------|--------|
| Schema | `backend/repositories/designSchemaRepository.js` |
| Session repo | `backend/repositories/ingestionSessionRepository.js` (new) |
| Normalize | `backend/services/designIngestion/normalize.js` (new) |
| Validator | `backend/services/designIngestion/validator.js` |
| Diff | `backend/services/designIngestion/differ.js` |
| Formatter / grid | `backend/services/designIngestion/formatter.js` |
| Orchestration | `backend/services/designExcelService.js` |
| Storage | `backend/lib/supabaseStorage.js` |
| Frontend | `frontend/src/types/index.ts`, `frontend/src/components/DesignExcelUploadModal.tsx` |
| Tests | `backend/tests/designIngestionDiffer.test.js` |
| Doc | `docs/INGESTION_SESSION_LAYER.md` |

## 10. Verification

- `node backend/tests/designIngestionDiffer.test.js` — passes, including **canonical casing** match → `EXISTING`.
- `node backend/tests/designIngestionValidator.test.js` — passes.
- `node -e "require('./services/designExcelService')"` from `backend/` — loads without syntax errors.

Run full app DB migration path that executes `ensureDesignDepartmentSchema` so `design.ingestion_sessions` exists before preview/commit in that environment.
