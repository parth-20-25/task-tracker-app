const { randomUUID } = require("crypto");
const { safeSerialize } = require("./serialization");
const { redactSensitiveData } = require("./redaction");

const LEVELS = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
};

function formatMessage(level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  const safeMetadata = redactSensitiveData(metadata);
  
  // Create a base object for logging
  const logObject = {
    timestamp,
    level,
    message,
  };

  // Safely merge metadata, handling cases where it might be a primitive or circular
  if (safeMetadata && typeof safeMetadata === "object") {
    Object.keys(safeMetadata).forEach(key => {
      try {
        const val = safeMetadata[key];
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
  } else if (safeMetadata !== undefined) {

    logObject.metadata = safeMetadata;
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
