import { TaskAssignmentBar } from "@/components/TaskAssignmentBar";

export default function AssignmentsTab() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Assignment System</h2>
        <p className="text-sm text-slate-500">
          Route department workflow work through templates, and keep executive intervention tasks separate.
        </p>
      </div>
      <TaskAssignmentBar />
    </div>
  );
}
