const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { loginUser } = require("../services/authService");

const router = express.Router();

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const result = await loginUser(req.body.employee_id, req.body.password);
    return sendSuccess(res, result);
  }),
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => sendSuccess(res, { user: req.user })),
);

module.exports = {
  authRoutes: router,
};
