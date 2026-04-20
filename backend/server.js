const express = require("express");
const app = express();

const cors = require("cors");
const path = require("path");

const { env } = require("./config/env");

// Routes
const { adminRoutes } = require("./routes/adminRoutes");
const { authRoutes } = require("./routes/authRoutes");
const { taskRoutes } = require("./routes/taskRoutes");
const { notificationRoutes } = require("./routes/notificationRoutes");
const { analyticsRoutes } = require("./routes/analyticsRoutes");
const { reportRoutes } = require("./routes/reportRoutes");
const { designRoutes } = require("./routes/designRoutes");

// Middleware
const { requestLogger } = require("./middleware/requestLogger");
const { errorHandler } = require("./middleware/errorHandler");

// Services
const { initDatabase } = require("./services/bootstrapService");
const { startEscalationWorker } = require("./services/escalationWorkerService");
const { processJobs } = require("./services/jobService");

console.log("SERVER STARTING...");
console.log("PORT:", process.env.PORT);

// App configuration (middlewares)
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());
app.use(requestLogger);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Mount routes
app.use("/api", authRoutes);
app.use("/api", taskRoutes);
app.use("/api", designRoutes);
app.use("/api", notificationRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", reportRoutes);
app.use("/api", adminRoutes);

app.use(errorHandler);

app.get("/", (req, res) => {
  res.send("Backend is running");
});

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
  await initDatabase();

  return new Promise((resolve) => {
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      startEscalationWorker();
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