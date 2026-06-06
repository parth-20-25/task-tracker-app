const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERN = /(^|[_-])(password|pass|secret|token|authorization|cookie|apikey|api_key|service_key|servicekey|jwt|database_url|connection_string|connectionstring|credential|smtp_password|password_hash)([_-]|$)/i;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key || ""));
}

function redactSensitiveData(value, parentKey = "") {
  if (isSensitiveKey(parentKey)) {
    return REDACTED;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item));
  }

  if (typeof value !== "object") {
    return value;
  }

  const redacted = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = redactSensitiveData(nestedValue, key);
  }

  return redacted;
}

module.exports = {
  REDACTED,
  isSensitiveKey,
  redactSensitiveData,
};
