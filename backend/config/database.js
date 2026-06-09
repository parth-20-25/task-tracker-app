const { resolveDatabaseSslConfig } = require("../lib/databaseSsl");

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

function resolveDatabaseUrlConfig(databaseUrl) {
  const connectionString = String(databaseUrl || "").trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for PostgreSQL connectivity.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(connectionString);
  } catch (_error) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (!POSTGRES_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
  }

  const database = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, "")).trim();
  if (!database) {
    throw new Error(
      "DATABASE_URL must include an explicit database name, for example postgresql://user:password@host:5432/database.",
    );
  }

  return {
    connectionString,
    database,
  };
}

function buildDatabasePoolConfig({
  databaseUrl = process.env.DATABASE_URL,
  databaseSsl = process.env.DATABASE_SSL,
  pgSslMode = process.env.PGSSLMODE,
} = {}) {
  const { connectionString, database } = resolveDatabaseUrlConfig(databaseUrl);

  return {
    connectionString,
    database,
    ssl: resolveDatabaseSslConfig({
      databaseUrl: connectionString,
      databaseSsl,
      pgSslMode,
    }),
  };
}

module.exports = {
  buildDatabasePoolConfig,
  resolveDatabaseUrlConfig,
};
