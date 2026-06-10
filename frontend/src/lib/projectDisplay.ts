export function formatDesignProjectLabel(project?: {
  project_code?: string | null;
  project_no?: string | null;
  project_name?: string | null;
  is_modified?: boolean | null;
  project_is_modified?: boolean | null;
}) {
  const code = formatProjectNumber(project);
  const name = String(project?.project_name || "")
    .trim()
    .replace(/^WBS\s*[-_]?\s*/i, "")
    .replace(/^[-_]+\s*(?=\S)/, "");

  if (code && name && code !== name) {
    return `${code} - ${name}`;
  }

  return code || name || "Project";
}

export function formatProjectNumber(project?: {
  project_code?: string | null;
  project_no?: string | null;
  is_modified?: boolean | null;
  project_is_modified?: boolean | null;
}) {
  const code = String(project?.project_no || project?.project_code || "")
    .trim()
    .replace(/^WBS\s*[-_]?\s*/i, "")
    .replace(/\s+/g, "")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!code) {
    return "";
  }

  return project?.is_modified === true || project?.project_is_modified === true ? `${code}-mod` : code;
}
