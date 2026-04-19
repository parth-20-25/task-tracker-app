const { randomUUID } = require("crypto");

const LEVELS = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
};

function formatMessage(level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  return JSON.stringify({
    timestamp,
    level,
    message,
    ...metadata,
  });
}

const logger = {
  info: (message, metadata) => console.log(formatMessage(LEVELS.INFO, message, metadata)),
  warn: (message, metadata) => console.warn(formatMessage(LEVELS.WARN, message, metadata)),
  error: (message, metadata) => console.error(formatMessage(LEVELS.ERROR, message, metadata)),
  generateRequestId: () => randomUUID(),
};

module.exports = { logger };
