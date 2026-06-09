const { loadBackendEnv } = require("./config/loadEnv");

loadBackendEnv();

const express = require("express");
const cors = require("cors");
const { buildCorsOptions } = require("./config/cors");
const { getUploadsRoot } = require("./lib/runtimePaths");
const { requestLogger } = require("./middleware/requestLogger");
const { errorHandler } = require("./middleware/errorHandler");
const { adminRoutes } = require("./routes/adminRoutes");
const { authRoutes } = require("./routes/authRoutes");
const { taskRoutes } = require("./routes/taskRoutes");
const { analyticsRoutes } = require("./routes/analyticsRoutes");
const overviewRoute = require("./routes/analytics/overviewRoute");
const deadlineHonestyRoute = require("./routes/analytics/deadlineHonestyRoute");
const designerPerformanceRoute = require("./routes/analytics/designerPerformanceRoute");
const workflowHealthRoute = require("./routes/analytics/workflowHealthRoute");
const predictiveInsightsRoute = require("./routes/analytics/predictiveInsightsRoute");
const { reportRoutes } = require("./routes/reportRoutes");
const { designRoutes } = require("./routes/designRoutes");
const { nativeIngestionRoutes } = require("./routes/nativeIngestionRoutes");
const { workflowRoutes } = require("./routes/workflowRoutes");
const workflowAnalyticsRoutes = require("./routes/workflowAnalyticsRoutes");
const { batchRoutes } = require("./routes/batchRoutes");
const { issueRoutes } = require("./routes/issueRoutes");
const { env } = require("./config/env");

function createApp() {
  const app = express();
  const corsOptions = buildCorsOptions(env.corsOrigin);

  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));
  app.use(express.json());
  app.use(requestLogger);
  app.use("/uploads", express.static(getUploadsRoot()));

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/", (_req, res) => {
    res.send("Backend is running");
  });

  app.use("/api", authRoutes);
  app.use("/api", taskRoutes);
  app.use("/api", nativeIngestionRoutes);
  app.use("/api", designRoutes);
  app.use("/api", workflowRoutes);
  app.use("/api", batchRoutes);
  app.use("/api", issueRoutes);
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

  return app;
}

module.exports = {
  createApp,
};
