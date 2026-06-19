import { Task } from "@/types";
import { formatProjectNumber } from "@/lib/projectDisplay";

function normalizeTaskDisplayValue(value?: string | null) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  return normalizedValue || null;
}

export function getTaskCardDisplay(task: Pick<Task, "title" | "task_type" | "additional_task_kind" | "project_no" | "fixture_no" | "project_is_modified">) {
  const projectNo = normalizeTaskDisplayValue(formatProjectNumber({ project_no: task.project_no, project_is_modified: task.project_is_modified }));
  const fixtureNo = normalizeTaskDisplayValue(task.fixture_no);
  const projectFixture = projectNo && fixtureNo ? `${projectNo} · ${fixtureNo}` : projectNo || fixtureNo || "";

  if (task.task_type === "additional_design") {
    return {
      title: task.additional_task_kind || task.title,
      subtitle: projectFixture,
    };
  }

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
