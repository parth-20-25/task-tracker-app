const { logger } = require("../lib/logger");

function requestLogger(req, res, next) {
  req.requestId = logger.generateRequestId();

  const startTime = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    logger.info("Incoming Request", {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
    });
  });

  next();
}

module.exports = { requestLogger };
