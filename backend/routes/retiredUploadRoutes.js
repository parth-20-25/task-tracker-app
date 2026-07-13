const express = require("express");

const LEGACY_FIXTURE_UPLOAD_RETIRED_MESSAGE = "Legacy fixture upload has been retired. Use native fixture upload.";
const NATIVE_PREVIEW_UPLOAD_RETIRED_MESSAGE = "Native Fixture Upload now uses the native ingestion workspace API. Use native fixture upload.";
const NATIVE_INGESTION_REPLACEMENT = "/api/design/native-ingestion/sessions";

const router = express.Router();

function sendRetiredUploadResponse(message) {
  return (_req, res) => res.status(410).json({
    success: false,
    message,
    error: message,
    details: {
      replacement: NATIVE_INGESTION_REPLACEMENT,
    },
  });
}

const legacyRetired = sendRetiredUploadResponse(LEGACY_FIXTURE_UPLOAD_RETIRED_MESSAGE);
const nativePreviewRetired = sendRetiredUploadResponse(NATIVE_PREVIEW_UPLOAD_RETIRED_MESSAGE);

router.post("/department-projects", legacyRetired);
router.post("/upload/design-excel", legacyRetired);
router.post("/upload/design-excel/confirm", legacyRetired);
router.post("/design/upload", legacyRetired);
router.post("/design/upload/confirm", legacyRetired);
router.post("/design/upload/rejected-row/validate", legacyRetired);
router.get("/design/upload-batches/:batchId/fixtures", legacyRetired);
router.post("/design/fixtures/:fixtureId/reference-image", legacyRetired);

router.post("/upload/design-native-excel", nativePreviewRetired);
router.post("/upload/design-native-excel/confirm", nativePreviewRetired);
router.post("/design/native-upload", nativePreviewRetired);
router.post("/design/native-upload/confirm", nativePreviewRetired);
router.post("/design/native-upload/rejected-row/validate", nativePreviewRetired);
router.get("/design/native-upload-batches/:batchId/fixtures", nativePreviewRetired);

module.exports = {
  LEGACY_FIXTURE_UPLOAD_RETIRED_MESSAGE,
  NATIVE_INGESTION_REPLACEMENT,
  retiredUploadRoutes: router,
};
