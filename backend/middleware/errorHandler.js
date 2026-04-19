const { AppError } = require("../lib/AppError");
const { logger } = require("../lib/logger");

function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      errorCode: error.errorCode || "APP_ERROR",
      details: error.details || null,
    });
  }

  if (error?.code === "23505") {
    return res.status(409).json({
      success: false,
      message: "Conflict",
      errorCode: "DB_CONFLICT",
      details: error.detail || error.message || null,
    });
  }

  if (error?.code === "23503") {
    return res.status(409).json({
      success: false,
      message: "Referenced record conflict",
      errorCode: "DB_REFERENCE_CONFLICT",
      details: error.detail || error.message || null,
    });
  }

  if (error?.code === "23502" || error?.code === "22P02") {
    return res.status(400).json({
      success: false,
      message: "Invalid request data",
      errorCode: "INVALID_DATA",
      details: error.detail || error.message || null,
    });
  }

  logger.error("Unhandled Error", {
    errorCode: "INTERNAL_ERROR",
    message: error?.message,
    stack: error?.stack,
    requestId: _req.requestId,
  });

  return res.status(500).json({
    success: false,
    message: "Internal server error",
    errorCode: "INTERNAL_ERROR",
    details: error?.message || null,
  });
}

module.exports = {
  errorHandler,
};
