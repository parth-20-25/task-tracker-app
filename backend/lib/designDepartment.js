function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function isDesignDepartment(subject) {
  const departmentName = normalizeValue(subject?.department?.name || subject?.name);
  const departmentId = normalizeValue(subject?.department_id || subject?.id);

  return departmentName === "design" || departmentId === "design";
}

module.exports = {
  isDesignDepartment,
};
