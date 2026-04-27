const { logger } = require("../lib/logger");
const {
  buildRouteLabel,
  inferFeature,
  inferWorkflow,
  runWithRequestContext,
  safeSerialize,
  sanitizeRequestPayload,
  updateRequestContext,
} = require("../lib/observability");

function requestLogger(req, res, next) {
  const requestId = logger.generateRequestId();
  const route = buildRouteLabel(req);
  const context = {
    requestId,
    route,
    feature: inferFeature(req.originalUrl),
    workflow: inferWorkflow(route),
    userId: null,
  };

  return runWithRequestContext(context, () => {
    logger.info("HTTP request started", {
      requestId,
      route,
      method: req.method,
      url: req.originalUrl,
      payload: sanitizeRequestPayload(req),
    });

    res.on("finish", () => {
      const currentContext = updateRequestContext({
        userId: req.user?.employee_id || req.auth?.employee_id || null,
      }) || context;

      logger.info("HTTP request completed", {
        requestId: currentContext.requestId,
        route: currentContext.route,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        userId: currentContext.userId,
      });
    });

    res.on("close", () => {
      if (res.writableEnded) {
        return;
      }

      const currentContext = updateRequestContext({
        userId: req.user?.employee_id || req.auth?.employee_id || null,
      }) || context;

      logger.warn("HTTP request closed before response completed", {
        requestId: currentContext.requestId,
        route: currentContext.route,
        method: req.method,
        url: req.originalUrl,
        payload: safeSerialize(sanitizeRequestPayload(req)),
      });
    });

    return next();
  });
}

module.exports = { requestLogger };
