const bcrypt = require("bcrypt");
const { AppError } = require("../lib/AppError");
const { createAuditLog } = require("../repositories/auditRepository");
const { findAuthRecordByEmployeeId, findUserByEmployeeId } = require("../repositories/usersRepository");
const { loadPermissions } = require("../middleware/authorize");
const { generateToken } = require("../auth");

async function loginUser(employeeId, password) {
  if (!employeeId || !password) {
    throw new AppError(400, "Employee ID and password are required");
  }

  const authRecord = await findAuthRecordByEmployeeId(employeeId);

  if (!authRecord) {
    throw new AppError(401, "User not found");
  }

  const isMatch = await bcrypt.compare(password, authRecord.password_hash);

  if (!isMatch) {
    throw new AppError(401, "Invalid password");
  }

  const user = await findUserByEmployeeId(employeeId);
  if (!user || !user.is_active) {
    throw new AppError(401, "User not found or inactive");
  }

  if (user) {
    user.permissions = await loadPermissions(user.role);
  }
  const token = generateToken(employeeId);

  await createAuditLog({
    userEmployeeId: employeeId,
    actionType: "login",
    targetType: "session",
    targetId: employeeId,
    metadata: { source: "web" },
  });

  return {
    token,
    user,
  };
}

async function getAuthenticatedUser(employeeId) {
  const user = await findUserByEmployeeId(employeeId);

  if (!user || !user.is_active) {
    throw new AppError(401, "User not found or inactive");
  }

  user.permissions = await loadPermissions(user.role);
  return user;
}

module.exports = {
  getAuthenticatedUser,
  loginUser,
};
