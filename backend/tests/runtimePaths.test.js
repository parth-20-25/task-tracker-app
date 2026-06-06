const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";
delete process.env.UPLOADS_DIR;
delete process.env.REPORT_TEMP_DIR;

const {
  getReportTempRoot,
  getTaskProofUploadDir,
  getUploadsRoot,
} = require("../lib/runtimePaths");

test("runtime paths resolve configured upload roots inside backend by default", () => {
  assert.equal(getUploadsRoot(), path.resolve(__dirname, "..", "uploads"));
  assert.equal(getTaskProofUploadDir(), path.join(getUploadsRoot(), "task-proofs"));
});

test("report temp root falls back to the OS temp directory", () => {
  assert.ok(path.isAbsolute(getReportTempRoot()));
});
