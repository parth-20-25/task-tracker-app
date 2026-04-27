const { AppError } = require("../lib/AppError");
const { logger } = require("../lib/logger");
const { getExecutionMetadata, safeSerialize } = require("../lib/observability");

function errorHandler(error, req, res, next) {
  const actualMessage = error?.message || "Unknown error";
  const actualDetail = error?.detail || null;
  const actualStack = error?.stack || null;

  // Use logger.error which now internally uses safeSerialize for all objects
  logger.error("Request failed", getExecutionMetadata({
    route: req.originalUrl,
    method: req.method,
    body: req.body, 
    params: req.params,
    query: req.query,
    errorMessage: actualMessage,
    errorDetail: actualDetail,
    status: error?.statusCode || 500,
    errorCode: error?.code || error?.errorCode || null,
    constraint: error?.constraint || null,
    stack: actualStack,
  }));

  if (res.headersSent) {
    return next(error);
  }


  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
      details: error.details || null,
    });
  }

  if (error?.constraint === "fwp_unique_fixture_stage") {
    return res.status(400).json({
      success: false,
      message: "An active task already exists for this fixture stage",
      error: "An active task already exists for this fixture stage",
      details: {
        code: error.code || null,
        constraint: error.constraint,
        detail: actualDetail,
        message: actualMessage,
      },
    });
  }

  if (error?.code === "23505") {
    return res.status(409).json({
      success: false,
      message: actualMessage,
      error: actualMessage,
      details: {
        code: error.code,
        constraint: error.constraint || null,
        detail: actualDetail,
      },
    });
  }

  if (error?.code === "23503") {
    return res.status(409).json({
      success: false,
      message: actualMessage,
      error: actualMessage,
      details: {
        code: error.code,
        constraint: error.constraint || null,
        detail: actualDetail,
      },
    });
  }

  if (error?.code === "23502" || error?.code === "22P02") {
    return res.status(400).json({
      success: false,
      message: actualMessage,
      error: actualMessage,
      details: {
        code: error.code,
        constraint: error.constraint || null,
        detail: actualDetail,
      },
    });
  }

  if (error?.code && typeof error.code === "string") {
    return res.status(500).json({
      success: false,
      message: actualMessage,
      error: actualMessage,
      details: {
        code: error.code,
        constraint: error.constraint || null,
        detail: actualDetail,
        stack: actualStack,
      },
    });
  }

  return res.status(error?.statusCode || 500).json({
    success: false,
    message: error?.statusCode ? actualMessage : actualMessage,
    error: error?.statusCode ? actualMessage : actualMessage,
    details: error?.details || actualDetail,
  });
}

module.exports = {
  errorHandler,
};
