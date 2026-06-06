import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatEmployeeDisplay } from "@/lib/employeeDisplay";
import { cn } from "@/lib/utils";
import type { DesignFixtureOption } from "@/types";

interface WorkflowAwareFixtureSelectProps {
  fixtures: DesignFixtureOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder: string;
}

const statusClasses: Record<string, string> = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
  review: "border-amber-200 bg-amber-50 text-amber-700",
  rework: "border-red-200 bg-red-50 text-red-700",
  active: "border-blue-200 bg-blue-50 text-blue-700",
  assigned: "border-slate-200 bg-slate-50 text-slate-700",
  unassigned: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

function formatStageLabel(fixture: DesignFixtureOption) {
  if (fixture.workflow_stage_label) {
    return fixture.workflow_stage_label;
  }

  if (fixture.workflow_stage) {
    return fixture.workflow_stage;
  }

  return fixture.is_workflow_complete ? "Completed" : "Workflow Pending";
}

function resolveWorkflowState(fixture: DesignFixtureOption) {
  const operationalState = String(fixture.operational_state || "").toUpperCase();
  const status = String(fixture.workflow_status || "").toUpperCase();

  if (operationalState === "WORKFLOW_COMPLETE" || fixture.is_workflow_complete) {
    return { label: "Completed", tone: "complete" };
  }

  if (operationalState === "VERIFICATION" || fixture.review_pending) {
    return { label: "Verification", tone: "review" };
  }

  if (fixture.blocked || status === "REJECTED") {
    return { label: "Blocked", tone: "rework" };
  }

  if (operationalState === "IN_PROGRESS" || fixture.workflow_stage_active || status === "IN_PROGRESS") {
    return { label: "In Progress", tone: "active" };
  }

  if (operationalState === "ASSIGNED" || fixture.workflow_assigned_to) {
    return { label: "Assigned", tone: "assigned" };
  }

  return { label: "Unassigned", tone: "unassigned" };
}

function getOwnerLabel(fixture: DesignFixtureOption) {
  if (fixture.is_workflow_complete) {
    return "Complete";
  }

  if (fixture.workflow_assigned_to || fixture.workflow_assigned_to_name) {
    return `Assigned to ${formatEmployeeDisplay(fixture.workflow_assigned_to || null, fixture.workflow_assigned_to_name)}`;
  }

  return "Unassigned";
}

function getRevisionLabel(fixture: DesignFixtureOption) {
  if (fixture.workflow_revision_code) {
    return fixture.workflow_revision_code;
  }

  if (Number.isFinite(fixture.revision_no)) {
    return `R${fixture.revision_no}`;
  }

  return null;
}

function getFixtureTextValue(fixture: DesignFixtureOption) {
  return [
    fixture.fixture_no,
    fixture.part_name,
    formatStageLabel(fixture),
    getOwnerLabel(fixture),
    resolveWorkflowState(fixture).label,
    getRevisionLabel(fixture),
  ].filter(Boolean).join(" ");
}

function FixtureOptionContent({ fixture, compact = false }: { fixture: DesignFixtureOption; compact?: boolean }) {
  const state = resolveWorkflowState(fixture);
  const revisionLabel = getRevisionLabel(fixture);
  const chipClass = "inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-semibold";

  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate font-medium">{fixture.fixture_no}</span>
        {!compact && fixture.part_name ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{fixture.part_name}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className={cn(chipClass, "border-border bg-background text-foreground")}>
          {formatStageLabel(fixture)}
        </span>
        <span className={cn(chipClass, statusClasses[state.tone])}>
          {state.label}
        </span>
        <span className={cn(chipClass, "border-transparent bg-secondary text-secondary-foreground")}>
          {getOwnerLabel(fixture)}
        </span>
        {revisionLabel ? (
          <span className={cn(chipClass, "border-border bg-background text-foreground")}>
            {revisionLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function WorkflowAwareFixtureSelect({
  fixtures,
  value,
  onValueChange,
  disabled,
  placeholder,
}: WorkflowAwareFixtureSelectProps) {
  const selectedFixture = fixtures.find((fixture) => fixture.fixture_id === value) || null;

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className="h-auto min-h-12 items-center border-primary/40 py-2 text-left focus:border-primary"
        disabled={disabled}
      >
        {selectedFixture ? (
          <FixtureOptionContent fixture={selectedFixture} compact />
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent className="max-h-[360px] w-[var(--radix-select-trigger-width)]">
        {fixtures.map((fixture) => (
          <SelectItem
            key={fixture.fixture_id}
            value={fixture.fixture_id}
            textValue={getFixtureTextValue(fixture)}
            className="items-start py-2"
          >
            <FixtureOptionContent fixture={fixture} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
