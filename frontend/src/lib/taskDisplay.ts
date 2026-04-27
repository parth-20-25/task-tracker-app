import { Task } from "@/types";

function normalizeTaskDisplayValue(value?: string | null) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  return normalizedValue || null;
}

export function getTaskCardDisplay(task: Pick<Task, "project_no" | "fixture_no">) {
  const projectNo = normalizeTaskDisplayValue(task.project_no);
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
