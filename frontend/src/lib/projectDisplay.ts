export function formatDesignProjectLabel(project?: {
  project_code?: string | null;
  project_name?: string | null;
}) {
  const code = String(project?.project_code || "").trim().replace(/^WBS\s*[-_]?\s*/i, "");
  const name = String(project?.project_name || "").trim().replace(/^WBS\s*[-_]?\s*/i, "");

  if (code && name && code !== name) {
    return `${code} - ${name}`;
  }

  return code || name || "Project";
}
