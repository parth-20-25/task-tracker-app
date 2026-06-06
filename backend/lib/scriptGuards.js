function isProductionRuntime() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function isExplicitlyAllowed(envName) {
  return ["1", "true", "yes"].includes(String(process.env[envName] || "").trim().toLowerCase());
}

function assertSafeScriptExecution(scriptName, options = {}) {
  const overrideEnv = options.overrideEnv || "ALLOW_PRODUCTION_MAINTENANCE";

  if (!isProductionRuntime() || isExplicitlyAllowed(overrideEnv)) {
    return;
  }

  throw new Error(
    `${scriptName} is blocked when NODE_ENV=production. Set ${overrideEnv}=true only for an intentional maintenance run.`,
  );
}

module.exports = {
  assertSafeScriptExecution,
  isProductionRuntime,
};
