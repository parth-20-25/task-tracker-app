import type { ReactNode } from "react";
import { ChevronDown, User, UserCheck, UserX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface FixtureBoardSection<T> {
  key: string;
  label: string;
  description: string;
  background: string;
  text: string;
  accent: string;
  fixtures: T[];
}

interface FixtureStatusBoardProps<T> {
  sections: FixtureBoardSection<T>[];
  openSections: Record<string, boolean>;
  onOpenChange: (key: string, open: boolean) => void;
  renderFixture: (fixture: T) => ReactNode;
  renderSection?: (section: FixtureBoardSection<T>) => ReactNode | undefined;
}

export function FixtureStatusBoard<T>({
  sections,
  openSections,
  onOpenChange,
  renderFixture,
  renderSection,
}: FixtureStatusBoardProps<T>) {
  return (
    <div className="space-y-3">
      {sections.map((section) => {
        const customContent = renderSection?.(section);

        return (
          <Collapsible
            key={section.key}
            open={openSections[section.key] ?? true}
            onOpenChange={(open) => onOpenChange(section.key, open)}
            className="overflow-hidden rounded-lg border"
            style={{ backgroundColor: section.background, borderColor: section.accent }}
          >
            <CollapsibleTrigger
              className="flex w-full items-center justify-between gap-3 border-l-4 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              style={{
                backgroundColor: section.background,
                borderLeftColor: section.accent,
                color: section.text,
              }}
            >
              <span className="flex min-w-0 items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: section.accent }}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight" style={{ color: section.text }}>{section.label}</span>
                  <span className="block text-xs leading-snug opacity-90">{section.description}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                <Badge
                  variant="outline"
                  className="font-semibold"
                  style={{
                    backgroundColor: section.background,
                    borderColor: section.accent,
                    color: section.text,
                  }}
                >
                  {section.fixtures.length} fixture{section.fixtures.length === 1 ? "" : "s"}
                </Badge>
                <ChevronDown className={cn("h-4 w-4 transition-transform", openSections[section.key] ? "rotate-180" : "")} />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t bg-background p-3" style={{ borderTopColor: section.accent }}>
              {section.fixtures.length === 0 ? (
                <p className="text-xs text-muted-foreground">No fixtures in this section.</p>
              ) : customContent !== undefined ? customContent : (
                <div className="space-y-2">{section.fixtures.map(renderFixture)}</div>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

interface FixtureBoardCardProps {
  fixtureId: string;
  fixtureNo: string;
  partName?: string | null;
  activity?: ReactNode;
  assigned: boolean;
  assigneeName?: string | null;
  progressPercent?: number | null;
  submittedLabel?: string | null;
  actions?: ReactNode;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (fixtureId: string, checked: boolean) => void;
  children?: ReactNode;
}

export function FixtureBoardCard({
  fixtureId,
  fixtureNo,
  partName,
  activity,
  assigned,
  assigneeName,
  progressPercent,
  submittedLabel,
  actions,
  selectable = false,
  selected = false,
  onSelectedChange,
  children,
}: FixtureBoardCardProps) {
  const progress = progressPercent === null || progressPercent === undefined
    ? null
    : Math.max(0, Math.min(100, Number(progressPercent)));

  return (
    <div
      className={cn(
        "rounded-md border border-slate-200 bg-background px-3 py-2 transition-colors hover:bg-slate-50/70",
        selected && "border-primary bg-primary/5 hover:bg-primary/5",
      )}
    >
      <div className="space-y-2">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1.5fr)_auto_minmax(140px,auto)_minmax(150px,auto)_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-2">
            {selectable ? (
              <Checkbox
                className="mt-0.5"
                checked={selected}
                onCheckedChange={(checked) => onSelectedChange?.(fixtureId, checked === true)}
                aria-label={`Select ${fixtureNo}`}
              />
            ) : null}
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold leading-tight">{fixtureNo}</p>
              <p className="break-words text-xs leading-snug text-muted-foreground">{partName}</p>
            </div>
          </div>

          <div className="flex min-w-[210px] flex-wrap items-center gap-1.5 lg:justify-center">{activity}</div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "max-w-full gap-0.5 text-xs font-medium",
                assigned
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-slate-300 bg-slate-50 text-slate-500",
              )}
            >
              {assigned ? <UserCheck className="h-3 w-3 shrink-0" /> : <UserX className="h-3 w-3 shrink-0" />}
              <span className="break-words">{assigned ? assigneeName || "Assigned" : "Unassigned"}</span>
            </Badge>
          </div>

          <div className="min-w-0 text-xs text-muted-foreground">
            <div className="space-y-1">
              {progress !== null ? (
                <div className="flex items-center gap-2">
                  <User className="h-3 w-3 shrink-0" />
                  <Progress value={progress} className="h-1.5 w-16 shrink-0" />
                  <span className="font-semibold text-foreground">{progress}%</span>
                </div>
              ) : null}
              {assigned && submittedLabel ? <p>Submitted: {submittedLabel}</p> : null}
            </div>
          </div>

          <div className="flex flex-col items-start gap-1.5 lg:items-end">{actions}</div>
        </div>

        {children}
      </div>
    </div>
  );
}
