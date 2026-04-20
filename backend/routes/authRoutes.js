const express = require("express");
const { asyncHandler } = require("../lib/asyncHandler");
const { sendSuccess } = require("../lib/response");
const { authenticate } = require("../middleware/authenticate");
const { loginUser } = require("../services/authService");

const router = express.Router();

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    try {
      const identifier = req.body.employee_id || req.body.email || req.body.username;
      const password = req.body.password;

      console.log(`[AUTH] Login attempt received. Identifier: ${identifier ? identifier : 'MISSING'}, Password length: ${password ? password.length : 0}`);

      if (!identifier || !password) {
        console.log(`[AUTH] Login failed: Missing credentials`);
        return res.status(400).json({ success: false, reason: "missing_credentials" });
      }

      const result = await loginUser(identifier, password);
      console.log(`[AUTH] Login successful for user: ${identifier}`);
      return sendSuccess(res, result);
    } catch (error) {
      console.log(`[AUTH] Login error for request body ${JSON.stringify(req.body)}:`, error.message);
      
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
