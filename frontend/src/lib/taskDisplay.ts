import { Task } from "@/types";
import { formatProjectNumber } from "@/lib/projectDisplay";

function normalizeTaskDisplayValue(value?: string | null) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  return normalizedValue || null;
}

export function getTaskCardDisplay(task: Pick<Task, "project_no" | "fixture_no" | "project_is_modified">) {
  const projectNo = normalizeTaskDisplayValue(formatProjectNumber({ project_no: task.project_no, project_is_modified: task.project_is_modified }));
  const fixtureNo = normalizeTaskDisplayValue(task.fixture_no);

  if (projectNo && fixtureNo) {
    return {
      title: `${projectNo} - ${fixtureNo}`,
      subtitle: `${projectNo} · ${fixtureNo}`,
    };
  }

  const fallbackValue = projectNo || fixtureNo || "";

  return {
    title: fallbackValue,
    subtitle: fallbackValue,
  };
}
