import { DepartmentAssignmentFlow } from "@/components/DepartmentAssignmentFlow";

export default function AssignmentsTab() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Assignment System</h2>
        <p className="text-sm text-slate-500">
          Select a department context and continue inside that department's native assignment flow.
        </p>
      </div>
      <DepartmentAssignmentFlow allowDepartmentSelection />
    </div>
  );
}
