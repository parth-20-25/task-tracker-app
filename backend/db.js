const { Pool } = require("pg");
const { logger } = require("./lib/logger");
const { getExecutionMetadata, safeSerialize, summarizeQuery } = require("./lib/observability");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for PostgreSQL connectivity.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

function normalizeQueryText(query) {
  if (typeof query === "string") {
    return query;
  }

  return query?.text || "";
}

function normalizeQueryValues(query, values) {
  if (Array.isArray(values)) {
    return values;
  }

  if (query && Array.isArray(query.values)) {
    return query.values;
  }

  return [];
}

function formatQueryParams(values) {
  return values.map((value, index) => ({
    index: index + 1,
    type: value === null
      ? "null"
      : value instanceof Date
        ? "date"
        : Array.isArray(value)
          ? "array"
          : typeof value,
    value: value instanceof Date ? value.toISOString() : value,
  }));
}

function instrumentQueryable(queryable, label) {
  if (!queryable || typeof queryable.query !== "function") {
    return queryable;
  }

  if (queryable.__taskTrackerInstrumented === true) {
    return queryable;
  }

  const originalQuery = queryable.query.bind(queryable);
  queryable.__taskTrackerInstrumented = true;

  queryable.query = (query, values, callback) => {
    const startedAt = Date.now();
    const queryText = normalizeQueryText(query);
    const callbackArg = typeof values === "function"
      ? values
      : typeof callback === "function"
        ? callback
        : null;
    const queryValues = normalizeQueryValues(query, callbackArg ? undefined : values);
    const querySummary = summarizeQuery(queryText);
    const queryMetadata = {
      ...getExecutionMetadata({
        layer: "repository.db",
        connection: label,
        query: querySummary,
        params: formatQueryParams(queryValues),
      }),
    };

    logger.info("SQL query started", queryMetadata);

    const handleSuccess = (result) => {
      logger.info("SQL query completed", {
        ...queryMetadata,
        durationMs: Date.now() - startedAt,
        rowCount: result?.rowCount ?? result?.rows?.length ?? 0,
        firstRow: result?.rows?.length ? safeSerialize(result.rows[0]) : null,
      });

      return result;
    };

    const handleError = (error) => {
      logger.error("SQL query failed", {
        ...queryMetadata,
        durationMs: Date.now() - startedAt,
        errorCode: error?.code || null,
        errorMessage: error?.message || "Unknown database error",
        detail: error?.detail || null,
      });
    };

    if (callbackArg) {
      const wrappedCallback = (error, result) => {
        if (error) {
          handleError(error);
          return callbackArg(error, result);
        }

        handleSuccess(result);
        return callbackArg(error, result);
      };

      if (typeof values === "function") {
        return originalQuery(query, wrappedCallback);
      }

      return originalQuery(query, values, wrappedCallback);
    }

    return originalQuery(query, values)
      .then((result) => handleSuccess(result))
      .catch((error) => {
        handleError(error);
        throw error;
      });
  };

  return queryable;
}

instrumentQueryable(pool, "pool");

const originalConnect = pool.connect.bind(pool);
pool.connect = (...args) => {
  if (typeof args[0] === "function") {
    const callback = args[0];
    return originalConnect((error, client, release) => {
      if (error || !client) {
        return callback(error, client, release);
      }

      return callback(error, instrumentQueryable(client, "client"), release);
    });
  }

  return originalConnect(...args).then((client) => instrumentQueryable(client, "client"));
};

module.exports = pool;
module.exports.pool = pool;
