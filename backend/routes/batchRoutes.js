const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const {
  activateProjectForBatch,
  deleteBatch,
  getBatches,
  holdProjectForBatch,
  releaseProjectForBatch,
} = require("../services/batchService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/batches",
  asyncHandler(async (req, res) => {
    const batches = await getBatches(req.user);
    return sendSuccess(res, batches);
  }),
);

router.delete(
  "/batches/:id",
  asyncHandler(async (req, res) => {
    const result = await deleteBatch(req.user, req.params.id, req.query.force === "true");
    return sendSuccess(res, result);
  }),
);

router.post(
  "/batches/:id/on-hold",
  asyncHandler(async (req, res) => {
    const result = await holdProjectForBatch(req.user, req.params.id);
    return sendSuccess(res, result);
  }),
);

router.post(
  "/batches/:id/activate",
  asyncHandler(async (req, res) => {
    const result = await activateProjectForBatch(req.user, req.params.id);
    return sendSuccess(res, result);
  }),
);

router.post(
  "/batches/:id/release",
  asyncHandler(async (req, res) => {
    const result = await releaseProjectForBatch(req.user, req.params.id);
    return sendSuccess(res, result);
  }),
);

module.exports = {
  batchRoutes: router,
};
