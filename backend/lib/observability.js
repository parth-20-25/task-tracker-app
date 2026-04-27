const { AsyncLocalStorage } = require("async_hooks");
const { randomUUID } = require("crypto");
const { logger } = require("./logger");

const requestContextStorage = new AsyncLocalStorage();
const { safeSerialize, truncateText } = require("./serialization");

function getContext() {
  return requestContextStorage.getStore() || null;
}

function runWithRequestContext(context, callback) {
  return requestContextStorage.run({ ...context }, callback);
}

function updateRequestContext(partialContext = {}) {
  const currentContext = getContext();

  if (!currentContext) {
    return null;
  }

  Object.assign(currentContext, partialContext);
  return currentContext;
}

function ensureExecutionId() {
  const context = getContext();

  if (!context) {
    return randomUUID();
  }

  if (!context.executionId) {
    context.executionId = randomUUID();
  }

  return context.executionId;
}

function inferFeature(route) {
  const normalizedRoute = String(route || "").toLowerCase();

  if (normalizedRoute.includes("/upload/design-excel")) return "excel-upload";
  if (normalizedRoute.includes("/design/tasks")) return "design-task-creation";
  if (normalizedRoute.includes("/design/")) return "design-catalog";
  if (normalizedRoute.includes("/tasks")) return "tasks";
  if (normalizedRoute.includes("/workflows")) return "workflow-stage-assignment";
  if (normalizedRoute.includes("/batches")) return "batch-management";
  if (normalizedRoute.includes("/reports")) return "reporting";
  if (normalizedRoute.includes("/login") || normalizedRoute.includes("/me")) return "authentication";
  if (normalizedRoute.includes("/issues")) return "issues";
  if (normalizedRoute.includes("/admin")) return "admin";

  return "general";
}

function inferWorkflow(route) {
  const normalizedRoute = String(route || "").toLowerCase();

  if (normalizedRoute.includes("/upload/design-excel")) return "excel-upload-to-batch";
  if (normalizedRoute.includes("/design/tasks")) return "project-scope-fixture-selection";
  if (normalizedRoute.includes("/tasks/") && normalizedRoute.includes("patch")) return "task-update";
  if (normalizedRoute.includes("/tasks")) return "task-creation";
  if (normalizedRoute.includes("/workflows/assign")) return "workflow-stage-assignment";
  if (normalizedRoute.includes("/batches")) return "batch-deletion-safeguards";

  return null;
}

function buildRouteLabel(req) {
  const routePath = req.route?.path || req.path || req.originalUrl || "";
  const baseUrl = req.baseUrl || "";
  return `${req.method} ${baseUrl}${routePath}`.trim();
}

function sanitizeRequestPayload(req) {
  return {
    params: req.params || {},
    query: req.query || {},
    body: req.body || {},
  };
}

function getExecutionMetadata(extraMetadata = {}) {
  const context = getContext() || {};

  return {
    requestId: context.requestId || null,
    route: context.route || null,
    feature: context.feature || null,
    workflow: context.workflow || null,
    userId: context.userId || null,
    ...extraMetadata,
  };
}

async function traceExecution(layer, functionName, metadata, callback) {
  const startTime = Date.now();
  const executionId = ensureExecutionId();

  logger.info("Execution started", getExecutionMetadata({
    layer,
    functionName,
    executionId,
    metadata,
  }));

  try {
    const result = await callback();

    logger.info("Execution completed", getExecutionMetadata({
      layer,
      functionName,
      executionId,
      durationMs: Date.now() - startTime,
    }));

    return result;
  } catch (error) {
    logger.error("Execution failed", getExecutionMetadata({
      layer,
      functionName,
      executionId,
      durationMs: Date.now() - startTime,
      metadata,
      errorMessage: error?.message || "Unknown error",
      stack: error?.stack || null,
    }));

    throw error;
  }
}

function instrumentModuleExports(layer, exportedMembers) {
  return Object.fromEntries(
    Object.entries(exportedMembers).map(([memberName, memberValue]) => {
      if (typeof memberValue !== "function") {
        return [memberName, memberValue];
      }

      const wrappedFunction = async function instrumentedExport(...args) {
        return traceExecution(
          layer,
          memberName,
          { args: safeSerialize(args) },
          async () => {
            const result = await memberValue.apply(this, args);

            logger.info("Execution result", getExecutionMetadata({
              layer,
              functionName: memberName,
              executionId: ensureExecutionId(),
              result: safeSerialize(result),
            }));

            return result;
          },
        );
      };

      return [memberName, wrappedFunction];
    }),
  );
}

function summarizeQuery(queryText) {
  const normalizedQuery = typeof queryText === "string"
    ? queryText
    : queryText?.text || "";

  return truncateText(
    normalizedQuery.replace(/\s+/g, " ").trim(),
    600,
  );
}

function validateQueryResult(result, queryText) {
  if (!result || !Array.isArray(result.rows)) {
    const invalidResultError = new Error("Invalid database response: rows array missing");

    logger.error("Invalid database response", getExecutionMetadata({
      layer: "repository.db",
      query: summarizeQuery(queryText),
      result: safeSerialize(result),
      errorMessage: invalidResultError.message,
      stack: invalidResultError.stack,
    }));

    throw invalidResultError;
  }

  return result;
}

function registerProcessErrorHandlers() {
  if (process.__taskTrackerProcessErrorHandlersRegistered) {
    return;
  }

  process.__taskTrackerProcessErrorHandlersRegistered = true;

  process.on("unhandledRejection", (error) => {
    logger.error("Unhandled Rejection", getExecutionMetadata({
      layer: "process",
      errorMessage: error?.message || safeSerialize(error),
      stack: error?.stack || null,
    }));
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception", getExecutionMetadata({
      layer: "process",
      errorMessage: error?.message || safeSerialize(error),
      stack: error?.stack || null,
    }));
  });
}

module.exports = {
  buildRouteLabel,
  getExecutionMetadata,
  inferFeature,
  inferWorkflow,
  instrumentModuleExports,
  registerProcessErrorHandlers,
  runWithRequestContext,
  safeSerialize,
  sanitizeRequestPayload,
  summarizeQuery,
  traceExecution,
  truncateText,
  updateRequestContext,
  validateQueryResult,
};
