const bcrypt = require("bcrypt");
const { AppError } = require("../lib/AppError");
const { instrumentModuleExports } = require("../lib/observability");
const { createAuditLog } = require("../repositories/auditRepository");
const {
  findAuthRecordByEmployeeId,
  findUserByEmployeeId,
  getVisibleUserIdsForEmployee,
} = require("../repositories/usersRepository");
const { loadPermissions } = require("../middleware/authorize");
const { generateToken } = require("../auth");
const { isAdmin } = require("./accessControlService");

function normalizeIdentifier(identifier) {
  if (typeof identifier !== "string") {
    return "";
  }

  return identifier.trim();
}

async function loginUser(identifier, password) {
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const normalizedPassword = typeof password === "string" ? password : "";

  if (!normalizedIdentifier || !normalizedPassword) {
    throw new AppError(400, "Employee ID and password are required");
  }

  const authRecord = await findAuthRecordByEmployeeId(normalizedIdentifier);

  if (!authRecord) {
    throw new AppError(401, "User not found");
  }

  let isMatch = false;

  // Bcrypt hashes usually start with $2a$, $2b$, or $2y$
  // Fast check: if password_hash does not look like a bcrypt hash, maybe it's plain text.
  if (authRecord.password_hash && authRecord.password_hash.startsWith("$2")) {
    isMatch = await bcrypt.compare(normalizedPassword, authRecord.password_hash);
  } else {
    // Fallback for plain-text passwords (temporary compatibility)
    isMatch = normalizedPassword === authRecord.password_hash;
  }

  if (!isMatch) {
    throw new AppError(401, "Invalid password");
  }

  const canonicalEmployeeId = authRecord.employee_id;
  const user = await findUserByEmployeeId(canonicalEmployeeId);
  if (!user || user.is_active === false) {
    throw new AppError(401, "User not found or inactive");
  }

  user.permissions = await loadPermissions(user.role);
  user.visible_user_ids = isAdmin(user)
    ? null
    : await getVisibleUserIdsForEmployee(user.employee_id);
  const token = generateToken(canonicalEmployeeId);

  await createAuditLog({
    userEmployeeId: canonicalEmployeeId,
    actionType: "login",
    targetType: "session",
    targetId: canonicalEmployeeId,
    metadata: { source: "web" },
  });

  return {
    token,
    user,
  };
}

async function getAuthenticatedUser(employeeId) {
  const normalizedEmployeeId = normalizeIdentifier(employeeId);

  if (!normalizedEmployeeId) {
    throw new AppError(401, "User not found or inactive");
  }

  const user = await findUserByEmployeeId(normalizedEmployeeId);

  if (!user || !user.is_active) {
    throw new AppError(401, "User not found or inactive");
  }

  user.permissions = await loadPermissions(user.role);
  user.visible_user_ids = isAdmin(user)
    ? null
    : await getVisibleUserIdsForEmployee(user.employee_id);
  return user;
}

module.exports = instrumentModuleExports("service.authService", {
  getAuthenticatedUser,
  loginUser,
});
