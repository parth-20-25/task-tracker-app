const { AppError } = require("./AppError");

function normalizeDepartmentId(value) {
  return String(value || "").trim();
}

function getEffectiveDepartment(user, overrideDepartmentId) {
  return normalizeDepartmentId(overrideDepartmentId) || normalizeDepartmentId(user?.department_id);
}

function requireDepartmentContext(departmentId, message = "Invalid department context") {
  const normalizedDepartmentId = normalizeDepartmentId(departmentId);

  if (!normalizedDepartmentId) {
    throw new AppError(400, message);
  }

  return normalizedDepartmentId;
}

function requireUserDepartment(user, message = "User missing department_id") {
  const departmentId = normalizeDepartmentId(user?.department_id);

  if (!departmentId) {
    throw new AppError(400, message);
  }

  return departmentId;
}

module.exports = {
  getEffectiveDepartment,
  normalizeDepartmentId,
  requireDepartmentContext,
  requireUserDepartment,
};
