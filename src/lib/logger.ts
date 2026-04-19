/**
 * Frontend structured logger
 * We only log explicit events (i.e. critical errors) to avoid console noise.
 */
export const Logger = {
  error: (message: string, error?: unknown, metadata?: Record<string, unknown>) => {
    console.error(
      JSON.stringify({
        level: "ERROR",
        timestamp: new Date().toISOString(),
        message,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
        ...metadata,
      })
    );
  },
  warn: (message: string, metadata?: Record<string, unknown>) => {
    console.warn(
      JSON.stringify({
        level: "WARN",
        timestamp: new Date().toISOString(),
        message,
        ...metadata,
      })
    );
  },
  info: (message: string, metadata?: Record<string, unknown>) => {
    console.log(
      JSON.stringify({
        level: "INFO",
        timestamp: new Date().toISOString(),
        message,
        ...metadata,
      })
    );
  },
};
