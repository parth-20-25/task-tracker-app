export function formatDurationMinutes(totalMinutes?: number | null) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));

  if (minutes === 0) {
    return "0m";
  }

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (remainingMinutes > 0 || parts.length === 0) {
    parts.push(`${remainingMinutes}m`);
  }

  return parts.join(" ");
}
