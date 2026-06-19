export function formatEmployeeDisplay(employee?: {
  employee_id?: string | null;
  name?: string | null;
  display_name?: string | null;
} | string | null, name?: string | null) {
  if (typeof employee === "string") {
    const employeeId = employee.trim();
    const employeeName = String(name || "").trim();
    if (employeeId && employeeName) {
      return `${employeeId} - ${employeeName}`;
    }
    if (employeeId) {
      return `${employeeId} - Unknown User`;
    }
    return employeeName || "Not assigned";
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

  if (employeeId) {
    return `${employeeId} - Unknown User`;
  }

  return employeeName || "Not assigned";
}

export function formatIncompleteTaskWorkload(count?: number | null) {
  const normalizedCount = Number(count);

  if (!Number.isFinite(normalizedCount) || normalizedCount <= 0) {
    return "Free";
  }

  return String(Math.floor(normalizedCount));
}

export function formatAssigneeOption(employee: {
  employee_id?: string | null;
  name?: string | null;
  display_name?: string | null;
  incomplete_task_count?: number | null;
}) {
  return `${formatEmployeeDisplay(employee)} — ${formatIncompleteTaskWorkload(employee.incomplete_task_count)}`;
}
