const { loadBackendEnv } = require("./config/loadEnv");

loadBackendEnv();

const { env, validateBackendEnv } = require("./config/env");
const { registerProcessErrorHandlers } = require("./lib/observability");
const { ensureRuntimeDirectoriesWritable } = require("./lib/runtimePaths");
const { createApp } = require("./app");
const { initializeDesktopNotificationGateway } = require("./services/desktopNotificationGateway");

// Services
const { initDatabase } = require("./services/bootstrapService");
const { startEscalationWorker } = require("./services/escalationWorkerService");
const { startPerformanceAnalyticsWorker } = require("./services/performanceAnalyticsWorkerService");

console.log("SERVER STARTING...");
console.log("HOST:", process.env.HOST);
console.log("PORT:", process.env.PORT);
registerProcessErrorHandlers();

const app = createApp();
let activeServer = null;

async function startServer() {
  validateBackendEnv();
  await ensureRuntimeDirectoriesWritable();
  await initDatabase();

  return new Promise((resolve) => {
    const PORT = env.port;
    const HOST = env.host;
    const server = app.listen(PORT, HOST, () => {
      activeServer = server;
      startEscalationWorker();
      startPerformanceAnalyticsWorker();
      console.log(`Server running on ${HOST}:${PORT}`);

      resolve(server);
    });

    activeServer = server;
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("SERVER START ERROR:", error);
    process.exit(1);
  });
}

module.exports = {
  app,
  getActiveServer: () => activeServer,
  startServer,
};
