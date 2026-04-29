import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllDepartments } from "@/api/adminApi";
import { getCachedDepartments } from "@/lib/referenceDataCache";
import { adminQueryKeys } from "@/lib/queryKeys";
import { DesignTaskAssignmentBar as AdminDesignTaskAssignmentBar } from "@/components/DesignTaskAssignmentBar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DepartmentOption = {
  id: string;
  name: string;
};

function isDesignDepartmentOption(department: DepartmentOption | null) {
  if (!department) {
    return false;
  }

  const id = String(department.id || "").trim().toLowerCase();
  const name = String(department.name || "").trim().toLowerCase();
  return id === "design" || name === "design";
}

export function AdminDashboardDepartmentExperience() {
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");

  const departmentsQuery = useQuery({
    queryKey: adminQueryKeys.departments,
    queryFn: fetchAllDepartments,
    placeholderData: () => getCachedDepartments<DepartmentOption[]>("all-departments") ?? undefined,
  });

  const departments = useMemo(
    () => (departmentsQuery.data ?? [])
      .filter((department) => department.id)
      .map((department) => ({
        id: department.id,
        name: department.name || department.id,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [departmentsQuery.data],
  );

  useEffect(() => {
    if (!selectedDepartmentId && departments[0]?.id) {
      setSelectedDepartmentId(departments[0].id);
    }
  }, [departments, selectedDepartmentId]);

  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId) ?? null;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Department Context</Label>
        <Select
          value={selectedDepartmentId}
          onValueChange={setSelectedDepartmentId}
          disabled={departmentsQuery.isLoading || departments.length === 0}
        >
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder={departmentsQuery.isLoading ? "Loading departments..." : "Select department"} />
          </SelectTrigger>
          <SelectContent>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isDesignDepartmentOption(selectedDepartment) ? (
        <AdminDesignTaskAssignmentBar
          departmentId={selectedDepartment.id}
          departmentName={selectedDepartment.name}
        />
      ) : (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold text-slate-900">Assignment System</h3>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500">
              This department has not yet been updated.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
