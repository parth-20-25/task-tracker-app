const { loadBackendEnv } = require("../config/loadEnv");

loadBackendEnv();

const { validateBackendEnv } = require("../config/env");
const { registerProcessErrorHandlers } = require("../lib/observability");
const { initDatabase } = require("../services/bootstrapService");
const { startDesktopNotificationWorker } = require("../services/desktopNotificationService");

async function main() {
  validateBackendEnv();
  registerProcessErrorHandlers();
  await initDatabase();
  startDesktopNotificationWorker({ intervalMs: Number(process.env.DESKTOP_NOTIFICATION_WORKER_INTERVAL_MS || 2000) });
  console.log("Desktop notification worker running");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Desktop notification worker failed to start", error);
    process.exit(1);
  });
}

module.exports = { main };
