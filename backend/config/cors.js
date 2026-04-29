function normalizeOriginPattern(pattern) {
  return String(pattern || "").trim().replace(/\/+$/g, "");
}

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map(normalizeOriginPattern)
    .filter(Boolean);
}

function deriveVercelPreviewPattern(origin) {
  const match = /^https:\/\/([a-z0-9-]+)\.vercel\.app$/i.exec(origin);

  if (!match) {
    return null;
  }

  return `https://${match[1]}-*.vercel.app`;
}

function buildEffectiveAllowedOrigins(allowedOrigins) {
  const derivedOrigins = allowedOrigins
    .map(deriveVercelPreviewPattern)
    .filter(Boolean);

  return [...new Set([...allowedOrigins, ...derivedOrigins])];
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
  const effectiveAllowedOrigins = buildEffectiveAllowedOrigins(
    allowedOrigins.map(normalizeOriginPattern).filter(Boolean),
  );

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
  const effectiveAllowedOrigins = buildEffectiveAllowedOrigins(configuredOrigins);

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
