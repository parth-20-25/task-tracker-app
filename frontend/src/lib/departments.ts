import { User } from "@/types";

function normalizeDepartmentValue(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function isDesignDepartment(user: Pick<User, "department_id" | "department"> | null | undefined) {
  const departmentName = normalizeDepartmentValue(user?.department?.name);
  const departmentId = normalizeDepartmentValue(user?.department_id);

  return departmentName === "design" || departmentId === "design";
}
