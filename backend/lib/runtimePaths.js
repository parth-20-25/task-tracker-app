const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { env } = require("../config/env");

function resolveBackendPath(configuredPath, fallbackPath) {
  const rawPath = String(configuredPath || fallbackPath || "").trim();
  const resolvedPath = rawPath || fallbackPath;

  if (path.isAbsolute(resolvedPath)) {
    return path.resolve(resolvedPath);
  }

  return path.resolve(__dirname, "..", resolvedPath);
}

function getUploadsRoot() {
  return resolveBackendPath(env.uploadsDir, "uploads");
}

function getTaskProofUploadDir() {
  return path.join(getUploadsRoot(), "task-proofs");
}

function getReportTempRoot() {
  const configured = String(env.reportTempDir || "").trim();
  return configured ? resolveBackendPath(configured, os.tmpdir()) : os.tmpdir();
}

function ensureDirectorySync(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

async function assertWritableDirectory(directoryPath) {
  await fsp.mkdir(directoryPath, { recursive: true });
  const probePath = path.join(directoryPath, `.write-test-${process.pid}-${Date.now()}`);
  await fsp.writeFile(probePath, "ok");
  await fsp.unlink(probePath);
}

async function ensureRuntimeDirectoriesWritable() {
  const uploadsRoot = getUploadsRoot();
  const taskProofUploadDir = getTaskProofUploadDir();
  const reportTempRoot = getReportTempRoot();

  await assertWritableDirectory(uploadsRoot);
  await assertWritableDirectory(taskProofUploadDir);
  await assertWritableDirectory(reportTempRoot);

  return {
    uploadsRoot,
    taskProofUploadDir,
    reportTempRoot,
  };
}

module.exports = {
  ensureDirectorySync,
  ensureRuntimeDirectoriesWritable,
  getReportTempRoot,
  getTaskProofUploadDir,
  getUploadsRoot,
  resolveBackendPath,
};
