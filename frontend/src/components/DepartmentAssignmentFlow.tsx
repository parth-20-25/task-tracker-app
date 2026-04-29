import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllDepartments } from "@/api/adminApi";
import {
  fetchDepartmentAssignmentContext,
  fetchTaskAssignmentReferenceData,
  type TaskAssignmentReferenceData,
} from "@/api/taskApi";
import { useAuth } from "@/contexts/useAuth";
import { getCachedDepartments } from "@/lib/referenceDataCache";
import { adminQueryKeys } from "@/lib/queryKeys";
import { DesignTaskAssignmentBar } from "@/components/DesignTaskAssignmentBar";
import { ListSkeleton } from "@/components/LoadingSkeletons";
import { TaskAssignmentBar } from "@/components/TaskAssignmentBar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DepartmentOption = {
  id: string;
  name: string;
};

interface DepartmentAssignmentFlowProps {
  allowDepartmentSelection?: boolean;
}

function normalizeDepartments(options: DepartmentOption[]) {
  return [...options]
    .filter((option) => option.id)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function DepartmentAssignmentFlow({
  allowDepartmentSelection = false,
}: DepartmentAssignmentFlowProps) {
  const { user } = useAuth();
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");

  const referenceDataQuery = useQuery({
    queryKey: ["task-assignment", "reference-data"],
    queryFn: fetchTaskAssignmentReferenceData,
    enabled: !allowDepartmentSelection,
    placeholderData: () => (
      getCachedDepartments<TaskAssignmentReferenceData>("assignment-reference-data") ?? undefined
    ),
  });

  const allDepartmentsQuery = useQuery({
    queryKey: adminQueryKeys.departments,
    queryFn: fetchAllDepartments,
    enabled: allowDepartmentSelection,
    placeholderData: () => getCachedDepartments<DepartmentOption[]>("all-departments") ?? undefined,
  });

  const selfDepartmentOptions = useMemo(() => {
    const departments = referenceDataQuery.data?.departments ?? [];
    if (departments.length > 0) {
      return normalizeDepartments(departments);
    }

    if (!user?.department_id) {
      return [];
    }

    return [{
      id: user.department_id,
      name: user.department?.name || user.department_id,
    }];
  }, [referenceDataQuery.data?.departments, user?.department?.name, user?.department_id]);

  const adminDepartmentOptions = useMemo(() => {
    const departments = (allDepartmentsQuery.data ?? []).map((department) => ({
      id: department.id,
      name: department.name || department.id,
    }));

    return normalizeDepartments(departments);
  }, [allDepartmentsQuery.data]);

  const departmentOptions = allowDepartmentSelection ? adminDepartmentOptions : selfDepartmentOptions;
  const effectiveDepartmentId = allowDepartmentSelection
    ? selectedDepartmentId
    : (user?.department_id || selectedDepartmentId);
  const selectedDepartmentName = useMemo(
    () => departmentOptions.find((department) => department.id === effectiveDepartmentId)?.name
      || user?.department?.name
      || effectiveDepartmentId,
    [departmentOptions, effectiveDepartmentId, user?.department?.name],
  );

  useEffect(() => {
    if (allowDepartmentSelection) {
      if (!selectedDepartmentId && departmentOptions[0]?.id) {
        setSelectedDepartmentId(departmentOptions[0].id);
      }
      return;
    }

    const fallbackDepartmentId = user?.department_id || departmentOptions[0]?.id || "";
    if (fallbackDepartmentId && fallbackDepartmentId !== selectedDepartmentId) {
      setSelectedDepartmentId(fallbackDepartmentId);
    }
  }, [allowDepartmentSelection, departmentOptions, selectedDepartmentId, user?.department_id]);

  const departmentContextQuery = useQuery({
    queryKey: ["task-assignment", "department-context", effectiveDepartmentId],
    queryFn: () => fetchDepartmentAssignmentContext(effectiveDepartmentId),
    enabled: !!effectiveDepartmentId,
  });

  return (
    <div className="space-y-4">
      {allowDepartmentSelection && (
        <div className="space-y-1.5">
          <Label>Department Context</Label>
          <Select
            value={selectedDepartmentId}
            onValueChange={setSelectedDepartmentId}
            disabled={allDepartmentsQuery.isLoading || departmentOptions.length === 0}
          >
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder={allDepartmentsQuery.isLoading ? "Loading departments..." : "Select department"} />
            </SelectTrigger>
            <SelectContent>
              {departmentOptions.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!effectiveDepartmentId ? (
        <Alert>
          <AlertTitle>Department required</AlertTitle>
          <AlertDescription>
            A valid department context is required before assignments can be created.
          </AlertDescription>
        </Alert>
      ) : departmentContextQuery.isLoading ? (
        <ListSkeleton count={1} />
      ) : departmentContextQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Assignment context unavailable</AlertTitle>
          <AlertDescription>
            {departmentContextQuery.error instanceof Error
              ? departmentContextQuery.error.message
              : "The selected department could not load its assignment flow."}
          </AlertDescription>
        </Alert>
      ) : departmentContextQuery.data?.flow_type === "project_catalog" ? (
        <DesignTaskAssignmentBar
          departmentId={allowDepartmentSelection ? effectiveDepartmentId : undefined}
          departmentName={selectedDepartmentName}
        />
      ) : (
        <TaskAssignmentBar
          presetDepartmentId={allowDepartmentSelection ? effectiveDepartmentId : undefined}
          presetDepartmentName={selectedDepartmentName}
          hideDepartmentSelector={allowDepartmentSelection}
        />
      )}
    </div>
  );
}
