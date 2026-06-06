export function formatEmployeeDisplay(employee?: {
  employee_id?: string | null;
  name?: string | null;
  display_name?: string | null;
} | string | null, name?: string | null) {
  if (typeof employee === "string") {
    const employeeId = employee.trim();
    const employeeName = String(name || "").trim();
    return employeeId && employeeName ? `${employeeId} - ${employeeName}` : employeeId || employeeName || "Unassigned";
  }

  const employeeId = String(employee?.employee_id || "").trim();
  const employeeName = String(employee?.name || name || "").trim();
  const displayName = String(employee?.display_name || "").trim();

  if (displayName) {
    return displayName;
  }

  if (employeeId && employeeName) {
    return `${employeeId} - ${employeeName}`;
  }

  return employeeId || employeeName || "Unassigned";
}
