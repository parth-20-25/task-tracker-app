const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");

const requireFromProject = createRequire(`${process.cwd()}/`);

function isMuslLinux() {
  const report = typeof process.report?.getReport === "function"
    ? process.report.getReport()
    : null;

  return process.platform === "linux"
    && !report?.header?.glibcVersionRuntime;
}

function resolveRollupNativePackageName() {
  if (process.platform !== "linux") {
    return null;
  }

  if (process.arch === "x64") {
    return `@rollup/rollup-linux-x64-${isMuslLinux() ? "musl" : "gnu"}`;
  }

  if (process.arch === "arm64") {
    return `@rollup/rollup-linux-arm64-${isMuslLinux() ? "musl" : "gnu"}`;
  }

  if (process.arch === "arm") {
    return "@rollup/rollup-linux-arm-gnueabihf";
  }

  return null;
}

function resolvePackageVersion(packageName) {
  return requireFromProject(`${packageName}/package.json`).version;
}

const nativePackageName = resolveRollupNativePackageName();

if (!nativePackageName) {
  process.exit(0);
}

try {
  requireFromProject.resolve(nativePackageName);
  process.exit(0);
} catch (_error) {
  // npm can omit Rollup's platform package when optional deps are in a bad state.
}

const rollupVersion = resolvePackageVersion("rollup");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const installResult = spawnSync(
  npmCommand,
  [
    "install",
    "--no-save",
    "--include=optional",
    `${nativePackageName}@${rollupVersion}`,
  ],
  {
    cwd: process.cwd(),
    stdio: "inherit",
  },
);

if (installResult.status !== 0) {
  process.stderr.write(
    `Failed to install ${nativePackageName}@${rollupVersion}. ` +
      "Remove node_modules and run: npm ci --include=optional\n",
  );
  process.exit(installResult.status || 1);
}
