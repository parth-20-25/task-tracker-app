export function formatDesignProjectLabel(project?: {
  project_code?: string | null;
  project_name?: string | null;
}) {
  const code = String(project?.project_code || "").trim();
  const name = String(project?.project_name || "").trim();

  if (code && name && code !== name) {
    return `${code} - ${name}`;
  }

  return code || name || "Project";
}
