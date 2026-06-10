const express = require("express");
const multer = require("multer");
const { PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { authorize } = require("../middleware/authorize");
const {
  buildNativeTemplateWorkbook,
  commitNativeSession,
  createNativeIngestionSession,
  createNativeProjectEditSession,
  importNativeExcel,
  pasteNativeClipboardRows,
  saveNativeDraft,
  stageNativeIngestionImage,
  validateNativeSession,
} = require("../services/nativeIngestion/sessionService");

const router = express.Router();

const nativeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

router.use(authenticate);

function parseFormJson(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    throw new AppError(400, "Malformed native ingestion context payload");
  }
}

router.post(
  "/design/native-ingestion/sessions",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await createNativeIngestionSession(req.user, req.body);
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  "/design/native-ingestion/projects/:projectId/edit-session",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await createNativeProjectEditSession(req.user, req.params.projectId, req.body || {});
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  "/design/native-ingestion/sessions/:sessionId/draft",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await saveNativeDraft(req.user, req.params.sessionId, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/native-ingestion/sessions/:sessionId/import-excel",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  nativeUpload.single("file"),
  asyncHandler(async (req, res) => {
    const result = await importNativeExcel(req.user, req.params.sessionId, req.file, {
      context: parseFormJson(req.body?.context),
    });
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/native-ingestion/sessions/:sessionId/paste",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await pasteNativeClipboardRows(req.user, req.params.sessionId, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/native-ingestion/sessions/:sessionId/validate",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await validateNativeSession(req.user, req.params.sessionId, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/native-ingestion/sessions/:sessionId/images/stage",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  nativeUpload.single("file"),
  asyncHandler(async (req, res) => {
    const result = await stageNativeIngestionImage(req.user, req.params.sessionId, req.file, {
      context: parseFormJson(req.body?.context),
      row_id: req.body?.row_id,
      fixture_no: req.body?.fixture_no,
      image_slot: req.body?.image_slot,
    });
    return sendSuccess(res, result, 200);
  }),
);

router.post(
  "/design/native-ingestion/sessions/:sessionId/commit",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (req, res) => {
    const result = await commitNativeSession(req.user, req.params.sessionId, req.body);
    return sendSuccess(res, result, 200);
  }),
);

router.get(
  "/design/native-ingestion/template",
  authorize(PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA),
  asyncHandler(async (_req, res) => {
    const workbook = buildNativeTemplateWorkbook();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"native-fixture-ingestion-template.xlsx\"");
    return res.status(200).send(workbook);
  }),
);

module.exports = {
  nativeIngestionRoutes: router,
};
