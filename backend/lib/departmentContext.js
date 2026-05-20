const { AppError } = require("./AppError");
const { hasOrgWideVisibility } = require("../services/visibilityResolutionService");

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

function resolveAccessibleDepartmentId(user, overrideDepartmentId, message = "Invalid department context") {
  const effectiveDepartmentId = getEffectiveDepartment(user, overrideDepartmentId);

  if (hasOrgWideVisibility(user)) {
    if (effectiveDepartmentId) {
      return requireDepartmentContext(effectiveDepartmentId, message);
    }

    return null;
  }

  const userDepartmentId = requireUserDepartment(user, message);

  if (effectiveDepartmentId && effectiveDepartmentId !== userDepartmentId) {
    throw new AppError(403, "You do not have permission to access another department");
  }

  return requireDepartmentContext(effectiveDepartmentId || userDepartmentId, message);
}

module.exports = {
  getEffectiveDepartment,
  normalizeDepartmentId,
  requireDepartmentContext,
  requireUserDepartment,
  resolveAccessibleDepartmentId,
};
