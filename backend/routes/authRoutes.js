const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { loginUser } = require("../services/authService");

const router = express.Router();

router.get("/login", (_req, res) => {
  return res.status(405).json({
    success: false,
    error: "Use POST /api/login to authenticate",
  });
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const identifier = body.employee_id || body.employeeId || body.email || body.username || body.identifier;
      const password = typeof body.password === "string" ? body.password : "";

      if (!identifier || !password) {
        return res.status(400).json({ success: false, reason: "missing_credentials" });
      }

      const result = await loginUser(identifier, password);
      return sendSuccess(res, result);
    } catch (error) {
      const status = error.statusCode || 500;
      let reason = "internal_error";
      
      if (error.message === "User not found" || error.message === "User not found or inactive") {
        reason = "user_not_found";
      } else if (error.message === "Invalid password") {
        reason = "invalid_password";
      }
      
      return res.status(status).json({ success: false, reason, message: error.message });
    }
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
