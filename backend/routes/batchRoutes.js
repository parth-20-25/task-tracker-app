const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { deleteBatch, getBatches } = require("../services/batchService");

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

module.exports = {
  batchRoutes: router,
};
