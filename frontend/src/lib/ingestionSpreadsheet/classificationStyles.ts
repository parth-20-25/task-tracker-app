import type { IngestionClassification } from "./types";

export function classificationLabel(classification: IngestionClassification): string {
  switch (classification) {
    case "NEW":
      return "NEW";
    case "UPDATED":
      return "UPDATED";
    case "EXISTING":
      return "EXISTING";
    case "CONFLICT":
      return "CONFLICT";
    case "DUPLICATE":
      return "DUPLICATE";
    case "INVALID":
      return "INVALID";
    case "SKIPPED":
      return "SKIPPED";
    default:
      return classification;
  }
}

export function classificationClassName(classification: IngestionClassification): string {
  switch (classification) {
    case "NEW":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "UPDATED":
      return "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300";
    case "EXISTING":
      return "bg-muted text-muted-foreground";
    case "CONFLICT":
      return "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300";
    case "DUPLICATE":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
    case "INVALID":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    case "SKIPPED":
      return "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}
