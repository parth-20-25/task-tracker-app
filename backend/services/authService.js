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

  console.log("LOGIN INPUT:", { employeeId, password });
  console.log("AUTH RECORD:", authRecord);
  console.log("PASSWORD HASH FIELD:", authRecord?.password_hash);

  if (!authRecord) {
    throw new AppError(401, "User not found");
  }

  let isMatch = false;
  
  // Bcrypt hashes usually start with $2a$, $2b$, or $2y$
  // Fast check: if password_hash does not look like a bcrypt hash, maybe it's plain text.
  if (authRecord.password_hash && authRecord.password_hash.startsWith("$2")) {
    isMatch = await bcrypt.compare(password, authRecord.password_hash);
  } else {
    // Fallback for plain-text passwords (temporary compatibility)
    isMatch = (password === authRecord.password_hash);
  }

  if (!isMatch) {
    throw new AppError(401, "Invalid password");
  }

  const user = await findUserByEmployeeId(employeeId);
  if (!user || user.is_active === false) {
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
