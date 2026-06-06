function normalizeOriginPattern(pattern) {
  return String(pattern || "").trim().replace(/\/+$/g, "");
}

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map(normalizeOriginPattern)
    .filter(Boolean);
}

function buildOriginRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOriginPattern(origin);
  const effectiveAllowedOrigins = allowedOrigins.map(normalizeOriginPattern).filter(Boolean);

  return effectiveAllowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin === "*") {
      return true;
    }

    if (allowedOrigin === normalizedOrigin) {
      return true;
    }

    if (!allowedOrigin.includes("*")) {
      return false;
    }

    return buildOriginRegex(allowedOrigin).test(normalizedOrigin);
  });
}

function buildCorsOptions(rawAllowedOrigins) {
  const configuredOrigins = parseAllowedOrigins(rawAllowedOrigins);
  const effectiveAllowedOrigins = configuredOrigins;

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = normalizeOriginPattern(origin);

      if (isOriginAllowed(normalizedOrigin, effectiveAllowedOrigins)) {
        callback(null, true);
        return;
      }

      console.warn("CORS origin rejected", {
        origin: normalizedOrigin,
        allowedOrigins: effectiveAllowedOrigins,
      });

      callback(new Error(`CORS origin not allowed: ${normalizedOrigin}`));
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Requested-With"
    ],
    optionsSuccessStatus: 204,
  };
}

module.exports = {
  buildCorsOptions,
  isOriginAllowed,
  parseAllowedOrigins,
};
