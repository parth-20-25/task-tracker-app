const { env } = require("./config/env");
const { createApp } = require("./app");
const { initDatabase } = require("./services/bootstrapService");
const { startEscalationWorker } = require("./services/escalationWorkerService");
const { processJobs } = require("./services/jobService");

async function startServer() {
  await initDatabase();
  const app = createApp();

  // Start job processor
  setInterval(processJobs, 5000); // Process jobs every 5 seconds

  return new Promise((resolve) => {
    const server = app.listen(env.port, () => {
      startEscalationWorker();
      console.log(`Backend running on http://localhost:${env.port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("SERVER START ERROR:", error);
    process.exit(1);
  });
}

module.exports = {
  startServer,
};
