const express = require("express");
const cors = require("cors");
const path = require("path");
const { requestLogger } = require("./middleware/requestLogger");
const { errorHandler } = require("./middleware/errorHandler");
const { adminRoutes } = require("./routes/adminRoutes");
const { authRoutes } = require("./routes/authRoutes");
const { taskRoutes } = require("./routes/taskRoutes");
const { notificationRoutes } = require("./routes/notificationRoutes");
const { analyticsRoutes } = require("./routes/analyticsRoutes");
const { reportRoutes } = require("./routes/reportRoutes");
const { designRoutes } = require("./routes/designRoutes");
const { workflowRoutes } = require("./routes/workflowRoutes");
const workflowAnalyticsRoutes = require("./routes/workflowAnalyticsRoutes");
const { batchRoutes } = require("./routes/batchRoutes");
const { issueRoutes } = require("./routes/issueRoutes");
const { env } = require("./config/env");

function createApp() {
  const app = express();

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

  app.use("/api", authRoutes);
  app.use("/api", taskRoutes);
  app.use("/api", designRoutes);
  app.use("/api", workflowRoutes);
  app.use("/api", batchRoutes);
  app.use("/api", issueRoutes);
  app.use("/api", notificationRoutes);
  app.use("/api", analyticsRoutes);
  app.use("/api/analytics/workflow", workflowAnalyticsRoutes);
  app.use("/api", reportRoutes);
  app.use("/api", adminRoutes);
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
};
