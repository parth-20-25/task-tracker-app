const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function normalizeRuntimeMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "production" ? "production" : "development";
}

function loadBackendEnv(options = {}) {
  const mode = normalizeRuntimeMode(options.mode || process.env.NODE_ENV);
  const override = options.override ?? mode === "production";
  process.env.NODE_ENV = mode;

  const candidateFiles = [`.env.${mode}`];
  if (mode === "development") {
    candidateFiles.push(".env");
  }

  for (const envFile of candidateFiles) {
    const envPath = path.resolve(__dirname, "..", envFile);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const result = dotenv.config({ path: envPath, override, quiet: true });
    return {
      mode,
      path: envPath,
      override,
      error: result.error || null,
    };
  }

  return {
    mode,
    path: null,
    override,
    error: null,
  };
}

module.exports = {
  loadBackendEnv,
  normalizeRuntimeMode,
};
