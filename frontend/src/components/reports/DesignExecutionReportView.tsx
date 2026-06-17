import { ExternalLink } from "lucide-react";
import { DesignReportDataResponse } from "@/api/reportApi";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ReportStage = DesignReportDataResponse["model"]["fixtureStageExecutionAudit"][number]["stages"][number];
type ReportFixture = DesignReportDataResponse["model"]["fixtureStageExecutionAudit"][number];

const STAGES = [
  { key: "concept", label: "Concept" },
  { key: "dap", label: "DAP" },
  { key: "three_d_finish", label: "3D" },
  { key: "two_d_finish", label: "2D" },
] as const;

const PROJECT_COLUMN_WIDTHS = [
  "min-w-[64px]",
  "min-w-[160px]",
  "min-w-[280px]",
  "min-w-[120px]",
  "min-w-[220px]",
  "min-w-[170px]",
];

function text(value: unknown, fallback = "Not recorded") {
  const clean = String(value ?? "").trim();
  return clean || fallback;
}

function formatPartFixtureName(opNo: unknown, fixtureName: unknown) {
  const name = text(fixtureName, "");
  if (/^OP\s*[^:]+:\s*/i.test(name)) {
    return name;
  }

  const operation = text(opNo, "").replace(/^OP\s*/i, "").replace(/:$/, "").trim();
  return operation ? `OP ${operation}: ${name}` : name;
}

function overviewValue(report: DesignReportDataResponse, label: string) {
  return report.model.overview.find((row) => row.label === label)?.value || "";
}

function statusColor(report: DesignReportDataResponse, value: string) {
  const colors = report.model.statusColors || {};
  if (colors[value]) {
    return colors[value];
  }

  if (/outsourced/i.test(value)) {
    return colors.Outsourced || "#0D9488";
  }

  if (/skip/i.test(value)) {
    return colors.Skipped || "#64748B";
  }

  if (/hold/i.test(value)) {
    return colors["On Hold"] || "#FF9800";
  }

  if (/overdue/i.test(value)) {
    return colors.Overdue || "#991B1B";
  }

  if (/rework|reject/i.test(value)) {
    return colors.Rework || colors.Rejected || "#DC2626";
  }

  if (/review|submitted/i.test(value)) {
    return colors["Under Review"] || "#8B5CF6";
  }

  if (/complete|approved|workflow completed/i.test(value)) {
    return colors.Completed || colors.Approved || "#22C55E";
  }

  if (/progress/i.test(value)) {
    return colors["In Progress"] || "#F59E0B";
  }

  if (/assign/i.test(value)) {
    return colors.Assigned || "#3A7BD5";
  }

  return colors["Not Started"] || "#E5E7EB";
}

function statusTextColor(background: string) {
  return ["#E5E7EB", "#F3F4F6", "#DCE6F2"].includes(background.toUpperCase())
    ? "#111827"
    : "#FFFFFF";
}

function stageByKey(fixture: ReportFixture, key: string) {
  const matching = fixture.stages.filter((stage) => stage.key === key);
  return matching[matching.length - 1] || null;
}

function preciseGlobalStatus(fixture: ReportFixture) {
  if (fixture.currentStatus === "Closed") {
    return "Workflow Completed";
  }

  if (fixture.currentStatus === "On Hold" || fixture.currentStatus === "Overdue") {
    return fixture.currentStatus;
  }

  const currentStage = fixture.stages.find((stage) => stage.stage === fixture.currentStage)
    || fixture.stages.find((stage) => stage.status !== "Approved" && stage.status !== "Skipped")
    || null;

  if (!currentStage) {
    return fixture.currentStatus || "Not Started";
  }

  if (currentStage.executionMode === "Outsourced" && currentStage.status !== "Approved") {
    return `${currentStage.stage} Outsourced`;
  }

  if (currentStage.status === "Rework") {
    return `${currentStage.stage} Rework`;
  }

  return `${currentStage.stage} ${currentStage.status}`;
}

function employeeLines(stage: ReportStage | null) {
  if (!stage) {
    return ["No assignment history recorded"];
  }

  if (stage.status === "Skipped") {
    return ["N/A"];
  }

  const workers = stage.workers || [];
  const realWorkers = workers.filter((worker) => {
    const name = text(worker.worker, "");
    return name && name !== "Not assigned" && name !== "N/A";
  });

  if (!realWorkers.length) {
    return ["Contribution split not recorded"];
  }

  return realWorkers.map((worker) => {
    const percent = text(worker.contributionPercent, "Contribution split not recorded");
    if (/not recorded/i.test(percent)) {
      return `${worker.worker} - Contribution split not recorded`;
    }
    return `${worker.worker} - ${percent}`;
  });
}

function proofIsImage(url: string) {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(url.split("?")[0] || "");
}

function plannedValue(stage: ReportStage) {
  if (stage.status === "Skipped") {
    return "N/A";
  }

  return [
    `Start: ${stage.plannedStart || "Not recorded"}`,
    `End / deadline: ${stage.plannedEnd || "Not recorded"}`,
    `Duration: ${stage.plannedDuration || stage.plannedTime || "Not recorded"}`,
  ].join("\n");
}

function actualValue(stage: ReportStage) {
  if (stage.status === "Skipped") {
    return "N/A";
  }

  return [
    `Start: ${stage.actualStart || "Not recorded"}`,
    `Completion / approval: ${stage.actualCompletion || stage.actualEnd || "Not recorded"}`,
    `Elapsed: ${stage.elapsedDuration || "Not recorded"}`,
  ].join("\n");
}

function StageCell({ report, stage }: { report: DesignReportDataResponse; stage: ReportStage | null }) {
  if (!stage) {
    return (
      <div className="min-h-[280px] space-y-3 text-xs text-muted-foreground">
        <StatusBadge report={report} value="Missing Required Data" />
        <div>Stage history missing</div>
      </div>
    );
  }

  return (
    <div className="min-h-[280px] space-y-3 text-xs leading-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge report={report} value={stage.executionStatus || stage.status} />
        <span className="font-medium text-muted-foreground">{stage.executionMode}</span>
      </div>

      {stage.statusReason ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">
          {stage.statusReason}
        </div>
      ) : null}

      {stage.transition ? <Info label="Transition" value={stage.transition} /> : null}
      {stage.vendor ? <Info label="Vendor" value={stage.vendor} /> : null}
      {stage.internalCoordinator ? <Info label="Coordinator" value={stage.internalCoordinator} /> : null}
      {stage.outsourcingStartedAt ? <Info label="Outsourcing Start" value={stage.outsourcingStartedAt} /> : null}
      {stage.outsourcingCompletedAt ? <Info label="Completion Date" value={stage.outsourcingCompletedAt} /> : null}

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Planned" value={plannedValue(stage)} />
        <Metric label="Actual" value={actualValue(stage)} />
        <Metric label="Tracked Working Time" value={stage.trackedWorkingTime || stage.actualTime || "Not recorded"} />
        <Metric label="Progress" value={stage.progress || "N/A"} />
        <Metric label="Variance" value={stage.variance || "N/A"} />
      </div>

      <Info label="Revision" value={[stage.revision, stage.revisionReason].filter(Boolean).join(" - ")} />
      <Info label="Approval" value={stage.approvalStatus || "Not recorded"} />

      <div>
        <div className="mb-1 font-semibold text-foreground">Employee Credits</div>
        <div className="whitespace-pre-line rounded bg-muted/40 p-2">
          {employeeLines(stage).join("\n")}
        </div>
      </div>

      <ProofLinks stage={stage} />

      <div>
        <div className="mb-1 font-semibold text-foreground">Hold History</div>
        <div className="max-h-28 overflow-auto whitespace-pre-line rounded bg-muted/40 p-2">
          {stage.holdSummary || "No hold history"}
        </div>
      </div>
    </div>
  );
}

function ProofLinks({ stage }: { stage: ReportStage }) {
  const links = stage.proofLinks || [];

  if (!links.length) {
    return (
      <div>
        <div className="mb-1 font-semibold text-foreground">Work Proof</div>
        <div className={cn(
          "rounded border px-2 py-1",
          /missing/i.test(stage.proofSummary || "") ? "border-rose-200 bg-rose-50 text-rose-800" : "bg-muted/40",
        )}>
          {stage.proofSummary || "Required Proof Missing"}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 font-semibold text-foreground">Work Proof ({links.length})</div>
      <div className="space-y-2">
        {links.map((proof, index) => (
          <a
            key={`${proof.url}-${index}`}
            href={proof.url}
            target="_blank"
            rel="noreferrer"
            title={proof.url}
            className="flex items-center gap-2 rounded border bg-background p-2 text-primary hover:bg-primary/5"
          >
            {proofIsImage(proof.url) ? (
              <img
                src={proof.url}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{proof.label || `View Proof ${index + 1}`}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div title={value}>
      <span className="font-semibold text-foreground">{label}: </span>
      <span className="whitespace-pre-line text-muted-foreground">{value || "Not recorded"}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-background px-2 py-1">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="whitespace-pre-line font-semibold text-foreground">{value}</div>
    </div>
  );
}

function StatusBadge({ report, value }: { report: DesignReportDataResponse; value: string }) {
  const background = statusColor(report, value);
  return (
    <Badge
      className="max-w-full justify-center whitespace-normal rounded px-2 py-1 text-center"
      style={{
        backgroundColor: background,
        borderColor: background,
        color: statusTextColor(background),
      }}
      title={value}
    >
      {value}
    </Badge>
  );
}

function Kpi({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="rounded border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold" style={tone ? { color: tone } : undefined}>
        {text(value, "0")}
      </div>
    </div>
  );
}

function SmallTable({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
  columns: Array<{ key: string; label: string }>;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded border">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-2 font-semibold">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.slice(0, 80).map((row, index) => (
              <tr key={index} className="border-t">
                {columns.map((column) => {
                  const value = row[column.key];
                  const isLink = typeof value === "string" && /^https?:\/\//i.test(value);
                  return (
                    <td key={column.key} className="max-w-[360px] px-3 py-2 align-top">
                      {isLink ? (
                        <a href={value} target="_blank" rel="noreferrer" className="text-primary underline">
                          View Proof
                        </a>
                      ) : (
                        <span className="whitespace-pre-line" title={text(value, "")}>{text(value, "")}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )) : (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={columns.length}>No records found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DesignExecutionReportView({ report }: { report: DesignReportDataResponse }) {
  const { model } = report;
  const colors = model.statusColors || {};

  return (
    <div className="min-h-screen bg-background text-foreground print:overflow-visible">
      <div className="space-y-6 p-4 print:p-0">
        <header className="space-y-4 border-b pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold">Fixture Stage Tracking Report</h2>
              <div className="mt-1 text-sm text-muted-foreground">
                Generated: {overviewValue(report, "Generated Date") || text(report.generated_at)}
              </div>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:min-w-[560px]">
              <Info label="Project Number" value={overviewValue(report, "Project Number")} />
              <Info label="Project Name" value={overviewValue(report, "Project Name")} />
              <Info label="Customer" value={overviewValue(report, "Customer")} />
              <Info label="Plant" value={overviewValue(report, "Plant")} />
              <Info label="Project Leader" value={overviewValue(report, "Project Leader")} />
              <Info label="Team Lead" value={overviewValue(report, "Team Lead")} />
              <Info label="Project Uploader" value={overviewValue(report, "Project Uploader")} />
              <Info label="Generated By" value={overviewValue(report, "Generated By") || model.generatedBy} />
            </div>
          </div>

          {report.validation.warnings.length ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {report.validation.warnings.slice(0, 4).join("\n")}
            </div>
          ) : null}
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Total Fixtures" value={model.kpis.totalFixtures} />
          <Kpi label="Workflow Completed" value={model.kpis.completedFixtures} tone={colors.Completed} />
          <Kpi label="In Progress" value={model.kpis.inProgressFixtures} tone={colors["In Progress"]} />
          <Kpi label="Assigned" value={model.kpis.assignedFixtures} tone={colors.Assigned} />
          <Kpi label="Unassigned" value={model.kpis.unassignedFixtures} tone={colors["Not Started"]} />
          <Kpi label="Overdue" value={model.kpis.overdueFixtures} tone={colors.Overdue} />
          <Kpi label="On Hold" value={model.kpis.onHoldFixtures} tone={colors["On Hold"]} />
          <Kpi label="In Rework" value={model.kpis.reworkCount} tone={colors.Rework} />
          <Kpi label="Outsourced" value={model.kpis.outsourcedFixtures} tone={colors.Outsourced} />
          <Kpi label="Stages Skipped" value={model.kpis.skippedStages} tone={colors.Skipped} />
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold">Stage Tracking Register</h3>
          <div className="overflow-x-auto rounded border print:overflow-visible">
            <table className="min-w-[3000px] border-separate border-spacing-0 text-left text-xs">
              <thead>
                <tr>
                  {["S. No", "Fixture No", "Part / Fixture Name", "Priority", "Current Assignment", "Global Status"].map((header, index) => (
                    <th
                      key={header}
                      rowSpan={2}
                      className={cn("border-b border-r bg-slate-100 px-3 py-2 font-semibold", PROJECT_COLUMN_WIDTHS[index])}
                    >
                      {header}
                    </th>
                  ))}
                  {STAGES.map((stage) => (
                    <th key={stage.key} className="border-b border-r bg-slate-900 px-3 py-2 text-center font-semibold text-white">
                      {stage.label}
                    </th>
                  ))}
                  <th className="border-b bg-slate-900 px-3 py-2 text-center font-semibold text-white">
                    Fixture Total
                  </th>
                </tr>
                <tr>
                  {STAGES.map((stage) => (
                    <th key={stage.key} className="min-w-[400px] border-b border-r bg-slate-100 px-3 py-2 font-semibold">
                      Status, hours, dates, progress, revision, employees, approval, proof, hold
                    </th>
                  ))}
                  <th className="min-w-[210px] border-b bg-slate-100 px-3 py-2 font-semibold">
                    Planned, actual, variance
                  </th>
                </tr>
              </thead>
              <tbody>
                {model.fixtureStageExecutionAudit.map((fixture, index) => {
                  const globalStatus = preciseGlobalStatus(fixture);
                  return (
                    <tr key={fixture.fixtureId || fixture.fixtureNumber} className="odd:bg-background even:bg-muted/20">
                      <td className={cn("border-b border-r px-3 py-3 align-top", PROJECT_COLUMN_WIDTHS[0])}>{index + 1}</td>
                      <td className={cn("border-b border-r px-3 py-3 align-top font-semibold", PROJECT_COLUMN_WIDTHS[1])} title={fixture.fixtureNumber}>{fixture.fixtureNumber}</td>
                      <td className={cn("border-b border-r px-3 py-3 align-top", PROJECT_COLUMN_WIDTHS[2])} title={fixture.fixtureName}>
                        {fixture.partFixtureName || formatPartFixtureName(fixture.opNo, fixture.fixtureName)}
                      </td>
                      <td className={cn("border-b border-r px-3 py-3 align-top", PROJECT_COLUMN_WIDTHS[3])}>{text(fixture.priority, "")}</td>
                      <td className={cn("border-b border-r px-3 py-3 align-top", PROJECT_COLUMN_WIDTHS[4])} title={fixture.assignedTo}>{text(fixture.assignedTo, "Unassigned")}</td>
                      <td className={cn("border-b border-r px-3 py-3 align-top", PROJECT_COLUMN_WIDTHS[5])}>
                        <StatusBadge report={report} value={globalStatus} />
                      </td>
                      {STAGES.map((stage) => (
                        <td key={stage.key} className="min-w-[400px] border-b border-r px-3 py-3 align-top">
                          <StageCell report={report} stage={stageByKey(fixture, stage.key)} />
                        </td>
                      ))}
                      <td className="min-w-[210px] border-b px-3 py-3 align-top">
                        <div className="space-y-2 text-xs">
                          <Metric label="Planned" value={text(fixture.totalPlannedHours, "N/A")} />
                          <Metric label="Actual" value={text(fixture.totalActualHours, "N/A")} />
                          <Metric label="Variance" value={text(fixture.totalVariance, "N/A")} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <SmallTable
          title="Work Proof Register"
          rows={model.workProofHistory}
          columns={[
            { key: "fixtureNumber", label: "Fixture" },
            { key: "stage", label: "Stage" },
            { key: "proofAvailability", label: "Availability" },
            { key: "proofLink", label: "Proof" },
            { key: "uploadedAt", label: "Uploaded At" },
            { key: "uploadedBy", label: "Uploaded By" },
          ]}
        />

        <SmallTable
          title="Hold History"
          rows={model.holdHistory}
          columns={[
            { key: "fixtureNumber", label: "Fixture" },
            { key: "date", label: "Hold Start" },
            { key: "stage", label: "Stage" },
            { key: "reason", label: "Reason" },
            { key: "heldBy", label: "Held By" },
            { key: "releasedBy", label: "Released By" },
            { key: "holdDuration", label: "Duration" },
          ]}
        />

        <SmallTable
          title="Revision History"
          rows={model.revisionHistory}
          columns={[
            { key: "fixture", label: "Fixture" },
            { key: "stage", label: "Stage" },
            { key: "revision", label: "Revision" },
            { key: "eventType", label: "Event" },
            { key: "reason", label: "Reason" },
            { key: "changedBy", label: "Changed By" },
            { key: "date", label: "Date" },
          ]}
        />

        <SmallTable
          title="Rework Register"
          rows={model.reworkAnalytics.rows}
          columns={[
            { key: "fixture", label: "Fixture" },
            { key: "stage", label: "Stage" },
            { key: "revision", label: "Revision" },
            { key: "reworkReason", label: "Reason" },
            { key: "initiatedBy", label: "Initiated By" },
            { key: "date", label: "Date" },
            { key: "durationImpact", label: "Impact" },
          ]}
        />
      </div>
    </div>
  );
}
