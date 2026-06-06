function parseBooleanFlag(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on", "require", "required"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) {
    return false;
  }

  return null;
}

function parseDatabaseUrl(databaseUrl) {
  try {
    return new URL(databaseUrl);
  } catch (_error) {
    return null;
  }
}

function isLocalDatabaseHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1";
}

function resolveDatabaseSslConfig({
  databaseUrl = process.env.DATABASE_URL,
  databaseSsl = process.env.DATABASE_SSL,
  pgSslMode = process.env.PGSSLMODE,
} = {}) {
  const explicitDatabaseSsl = parseBooleanFlag(databaseSsl);
  if (explicitDatabaseSsl === false) {
    return false;
  }
  if (explicitDatabaseSsl === true) {
    return { rejectUnauthorized: false };
  }

  const parsedUrl = parseDatabaseUrl(databaseUrl);
  const sslMode = String(pgSslMode || parsedUrl?.searchParams?.get("sslmode") || "")
    .trim()
    .toLowerCase();

  if (sslMode === "disable") {
    return false;
  }

  if (["require", "prefer", "allow", "verify-ca", "verify-full"].includes(sslMode)) {
    return { rejectUnauthorized: false };
  }

  if (isLocalDatabaseHost(parsedUrl?.hostname)) {
    return false;
  }

  return { rejectUnauthorized: false };
}

module.exports = {
  isLocalDatabaseHost,
  parseBooleanFlag,
  resolveDatabaseSslConfig,
};
