const { env } = require("./config/env");
const { createApp } = require("./app");
const { initDatabase } = require("./services/bootstrapService");
const { startEscalationWorker } = require("./services/escalationWorkerService");
const { processJobs } = require("./services/jobService");

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

async function safeProcessJobs() {
  try {
    await processJobs();
  } catch (err) {
    console.error("Job worker error:", err.message);
  }
}

async function startServer() {
  console.log("SERVER STARTING...");
  console.log("PORT:", process.env.PORT);

  await initDatabase();
  const app = createApp();
  
  // Register the root route after app is initialized
  app.get("/", (req, res) => {
    res.send("Backend is running");
  });

  return new Promise((resolve) => {
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      startEscalationWorker();
      console.log(`Backend running on http://localhost:${PORT}`);
      
      setTimeout(() => {
        setInterval(safeProcessJobs, 5000);
      }, 5000);

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