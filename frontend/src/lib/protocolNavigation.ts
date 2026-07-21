export function getProtocolTargetPath(target: string | null) {
  if (!target) return null;

  try {
    const url = new URL(target);
    if (url.protocol !== "web+parc:" || url.hostname !== "open" || url.username || url.password || url.port) return null;
    const path = url.searchParams.get("path");
    if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) return null;
    return path;
  } catch {
    return null;
  }
}