const {
  DEFAULT_REFRESH_INTERVAL_MS,
  refreshPerformanceAnalyticsAtStartup,
} = require("./performanceAnalyticsService");

let intervalHandle = null;
let isRefreshing = false;

async function runRefresh() {
  if (isRefreshing) {
    return;
  }

  isRefreshing = true;

  try {
    await refreshPerformanceAnalyticsAtStartup();
  } catch (error) {
    console.error("Performance analytics worker failed", error?.message || error);
  } finally {
    isRefreshing = false;
  }
}

function startPerformanceAnalyticsWorker() {
  if (intervalHandle) {
    return intervalHandle;
  }

  setTimeout(() => {
    void runRefresh();
  }, 2000);

  intervalHandle = setInterval(() => {
    void runRefresh();
  }, DEFAULT_REFRESH_INTERVAL_MS);

  return intervalHandle;
}

module.exports = {
  startPerformanceAnalyticsWorker,
};
