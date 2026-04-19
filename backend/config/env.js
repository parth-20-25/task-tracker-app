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
  jwtSecret: process.env.JWT_SECRET || "supersecretkey",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  uploadsDir: process.env.UPLOADS_DIR || "uploads",
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseNumber(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    from: process.env.SMTP_FROM || "TaskControl <no-reply@taskcontrol.local>",
  },
  db: {
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "task_tracking",
    password: process.env.PGPASSWORD || "123456",
    port: parseNumber(process.env.PGPORT, 5432),
  },
  rbac: {
    autoCreatePermissions: parseBoolean(process.env.RBAC_AUTO_CREATE_PERMISSIONS, false),
  },
};

module.exports = {
  env,
};
