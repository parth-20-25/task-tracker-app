function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalizedValue = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return fallback;
}

const env = {
  port: parseNumber(process.env.PORT, 5000),
  nodeEnv: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  corsOrigin: process.env.CORS_ORIGIN || "",
  enableTaskSeed: parseBoolean(process.env.ENABLE_TASK_SEED, false),
  uploadsDir: process.env.UPLOADS_DIR || "uploads",
  designExtraction: {
    serviceUrl: process.env.DESIGN_EXTRACTION_SERVICE_URL || "",
    token: process.env.DESIGN_EXTRACTION_SERVICE_TOKEN || "",
    timeoutMs: parseNumber(process.env.DESIGN_EXTRACTION_TIMEOUT_MS, 120000),
  },
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseNumber(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    from: process.env.SMTP_FROM || "TaskControl <no-reply@taskcontrol.local>",
  },
  db: {
    connectionString: process.env.DATABASE_URL || "",
  },
  rbac: {
    autoCreatePermissions: parseBoolean(process.env.RBAC_AUTO_CREATE_PERMISSIONS, false),
  },
};

function validateBackendEnv() {
  const requiredEnvVars = [
    "DATABASE_URL",
    "JWT_SECRET",
    "CORS_ORIGIN",
  ];
  const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);

  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required backend environment variables: ${missingEnvVars.join(", ")}`);
  }
}

module.exports = {
  env,
  validateBackendEnv,
};
