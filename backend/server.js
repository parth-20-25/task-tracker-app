require("dotenv").config();
const express = require("express");
const app = express();

const cors = require("cors");
const path = require("path");

const { env, validateBackendEnv } = require("./config/env");
const { registerProcessErrorHandlers } = require("./lib/observability");

// Routes
const { adminRoutes } = require("./routes/adminRoutes");
const { authRoutes } = require("./routes/authRoutes");
const { taskRoutes } = require("./routes/taskRoutes");
const { notificationRoutes } = require("./routes/notificationRoutes");
const { analyticsRoutes } = require("./routes/analyticsRoutes");
const overviewRoute = require("./routes/analytics/overviewRoute");
const deadlineHonestyRoute = require("./routes/analytics/deadlineHonestyRoute");
const designerPerformanceRoute = require("./routes/analytics/designerPerformanceRoute");
const workflowHealthRoute = require("./routes/analytics/workflowHealthRoute");
const predictiveInsightsRoute = require("./routes/analytics/predictiveInsightsRoute");
const workflowAnalyticsRoutes = require("./routes/workflowAnalyticsRoutes");
const { reportRoutes } = require("./routes/reportRoutes");
const { designRoutes } = require("./routes/designRoutes");
const { workflowRoutes } = require("./routes/workflowRoutes");
const { batchRoutes } = require("./routes/batchRoutes");
const { issueRoutes } = require("./routes/issueRoutes");

// Middleware
const { requestLogger } = require("./middleware/requestLogger");
const { errorHandler } = require("./middleware/errorHandler");

// Services
const { initDatabase } = require("./services/bootstrapService");
const { startEscalationWorker } = require("./services/escalationWorkerService");
const { startPerformanceAnalyticsWorker } = require("./services/performanceAnalyticsWorkerService");
const { processJobs } = require("./services/jobService");

console.log("SERVER STARTING...");
console.log("PORT:", process.env.PORT);
registerProcessErrorHandlers();

// App configuration (middlewares)
app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());
app.use(requestLogger);
app.use("/uploads", express.static(path.join(__dirname, env.uploadsDir)));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.send("Backend is running");
});

// Mount routes
app.use("/api", authRoutes);
app.use("/api", taskRoutes);
app.use("/api", designRoutes);
app.use("/api", workflowRoutes);
app.use("/api", batchRoutes);
app.use("/api", issueRoutes);
app.use("/api", notificationRoutes);
app.use("/api", analyticsRoutes);
app.use("/api/analytics", overviewRoute);
app.use("/api/analytics", deadlineHonestyRoute);
app.use("/api/analytics", designerPerformanceRoute);
app.use("/api/analytics", workflowHealthRoute);
app.use("/api/analytics", predictiveInsightsRoute);
app.use("/api/analytics/workflow", workflowAnalyticsRoutes);
app.use("/api", reportRoutes);
app.use("/api", adminRoutes);

app.use(errorHandler);

async function safeProcessJobs() {
  try {
    await processJobs();
  } catch (err) {
    console.error("Job worker error:", err.message);
  }
}

async function startServer() {
  validateBackendEnv();
  await initDatabase();

  return new Promise((resolve) => {
    const PORT = env.port;
    const server = app.listen(PORT, () => {
      startEscalationWorker();
      startPerformanceAnalyticsWorker();
      console.log(`Server running on port ${PORT}`);
      
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
