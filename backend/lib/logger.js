const { randomUUID } = require("crypto");
const { safeSerialize } = require("./serialization");

const LEVELS = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
};

function formatMessage(level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  
  // Create a base object for logging
  const logObject = {
    timestamp,
    level,
    message,
  };

  // Safely merge metadata, handling cases where it might be a primitive or circular
  if (metadata && typeof metadata === "object") {
    Object.keys(metadata).forEach(key => {
      try {
        const val = metadata[key];
        // If the value is an object, serialize it safely as a string
        if (val && typeof val === "object") {
          logObject[key] = safeSerialize(val);
        } else {
          logObject[key] = val;
        }
      } catch (err) {
        logObject[key] = "[Serialization Error]";
      }
    });
  } else if (metadata !== undefined) {

    logObject.metadata = metadata;
  }

  try {
    return JSON.stringify(logObject);
  } catch (err) {
    // Ultimate fallback if even the safe logObject fails
    return JSON.stringify({
      timestamp,
      level: "ERROR",
      message: "Log serialization failed catastrophically",
      originalLevel: level,
      originalMessage: message
    });
  }
}

const logger = {
  info: (message, metadata) => console.log(formatMessage(LEVELS.INFO, message, metadata)),
  warn: (message, metadata) => console.warn(formatMessage(LEVELS.WARN, message, metadata)),
  error: (message, metadata) => console.error(formatMessage(LEVELS.ERROR, message, metadata)),
  generateRequestId: () => randomUUID(),
};

module.exports = { logger };
