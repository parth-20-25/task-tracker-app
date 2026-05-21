import React, { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileSpreadsheet,
  Save,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import {
  commitNativeIngestion,
  createNativeIngestionSession,
  downloadNativeIngestionTemplate,
  importNativeIngestionExcel,
  pasteNativeIngestionClipboard,
  saveNativeIngestionDraft,
  stageNativeIngestionImage,
  validateNativeIngestion,
} from "@/api/nativeIngestionApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MorphLoader } from "@/components/ui/morph-loader";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/useAuth";
import { cn } from "@/lib/utils";
import type {
  NativeCommitResponse,
  NativeIngestionContext,
  NativeIngestionRow,
  NativeValidationSummary,
} from "./NativeIngestionTypes";
import { NativeConflictPanel } from "./NativeConflictPanel";
import { NativeSpreadsheetGrid } from "./NativeSpreadsheetGrid";
import {
  buildInitialRows,
  contextReady,
  defaultNativeContext,
  mergeValidationRows,
  nativeRowHasData,
  padRows,
} from "./nativeIngestionUtils";

type BusyAction =
  | "open"
  | "import"
  | "paste"
  | "template"
  | "validate"
  | "draft"
  | "commit"
  | "image"
  | null;

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "orange" | "red" | "slate";
}) {
  const toneClass = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    orange: "border-orange-200 bg-orange-50 text-orange-800",
    red: "border-red-200 bg-red-50 text-red-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];

  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium", toneClass)}>
      {label}
      <strong>{value}</strong>
    </span>
  );
}

function ContextInput({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="min-w-0">
      <Label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">{label}</Label>
      <Input
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        className={cn("h-9 bg-white text-sm", readOnly && "bg-slate-50 text-slate-500")}
      />
    </div>
  );
}

interface WorkspaceSurfaceProps {
  onClose: () => void;
}

function WorkspaceSurface({ onClose }: WorkspaceSurfaceProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [context, setContext] = useState<NativeIngestionContext>(() => defaultNativeContext(user));
  const [rows, setRows] = useState<NativeIngestionRow[]>(() => buildInitialRows());
  const [summary, setSummary] = useState<NativeValidationSummary | null>(null);
  const [focusedConflict, setFocusedConflict] = useState<NativeIngestionRow | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, "merge" | "replace" | "skip">>({});
  const [busy, setBusy] = useState<BusyAction>("open");
  const [lastCommit, setLastCommit] = useState<NativeCommitResponse | null>(null);

  React.useEffect(() => {
    let mounted = true;
    setBusy("open");
    void createNativeIngestionSession(context)
      .then((session) => {
        if (!mounted) return;
        setSessionId(session.session_id);
        setSessionExpiresAt(session.expires_at);
        setContext((current) => ({
          ...current,
          ...session.context,
          operational_batch: current.operational_batch,
        }));
        setRows(padRows(session.rows?.length ? session.rows : rows));
      })
      .catch((error) => {
        toast({
          title: "Native workspace failed to open",
          description: error instanceof Error ? error.message : "Could not create ingestion session",
          variant: "destructive",
        });
        onClose();
      })
      .finally(() => mounted && setBusy(null));

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create one backend session per workspace open
  }, []);

  const busyLabel = busy ? busy.charAt(0).toUpperCase() + busy.slice(1) : "";
  const isBusy = busy !== null;
  const conflictRows = rows.filter((row) => row.classification === "CONFLICT");
  const unresolvedConflictCount = conflictRows.filter((row) => !resolutions[row.row_id]).length;
  const rowCounts = useMemo(() => {
    const populated = rows.filter(nativeRowHasData).length;
    return {
      populated,
      errors: rows.filter((row) => row.severity === "error").length,
      conflicts: conflictRows.length,
      safe: rows.filter((row) => row.severity === "safe").length,
    };
  }, [conflictRows.length, rows]);

  const updateContext = (patch: Partial<NativeIngestionContext>) => {
    setContext((current) => ({ ...current, ...patch }));
  };

  const runImport = async (file: File) => {
    if (!sessionId) return;
    setBusy("import");
    try {
      const result = await importNativeIngestionExcel(sessionId, context, file);
      setRows(padRows(result.rows));
      setSummary(null);
      setResolutions({});
      toast({ title: "Workbook imported", description: `${result.rows.length} row(s) loaded from ${result.sheet_name}` });
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Workbook could not be imported",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const runPasteFromClipboard = async () => {
    if (!sessionId) return;
    setBusy("paste");
    try {
      const text = await navigator.clipboard.readText();
      const result = await pasteNativeIngestionClipboard(sessionId, context, text);
      setRows(padRows(result.rows));
      setSummary(null);
      setResolutions({});
      toast({ title: "Clipboard pasted", description: `${result.rows.length} row(s) loaded into session state` });
    } catch (error) {
      toast({
        title: "Paste failed",
        description: error instanceof Error ? error.message : "Clipboard could not be read",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const runValidate = async () => {
    if (!sessionId) return;
    setBusy("validate");
    try {
      const validation = await validateNativeIngestion(sessionId, context, rows);
      setContext((current) => ({ ...current, ...validation.context }));
      setRows(padRows(mergeValidationRows(rows, validation), rows.length));
      setSummary(validation.summary);
      toast({ title: "Validation complete", description: `${validation.summary.total_rows} populated row(s) checked` });
    } catch (error) {
      toast({
        title: "Validation failed",
        description: error instanceof Error ? error.message : "Backend validation did not complete",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const runSaveDraft = async () => {
    if (!sessionId) return;
    setBusy("draft");
    try {
      const result = await saveNativeIngestionDraft(sessionId, context, rows);
      toast({ title: "Draft saved", description: `${result.row_count} row(s) saved to ingestion session` });
    } catch (error) {
      toast({
        title: "Draft save failed",
        description: error instanceof Error ? error.message : "Draft could not be saved",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const runCommit = async () => {
    if (!sessionId) return;
    setBusy("commit");
    try {
      const result = await commitNativeIngestion(sessionId, context, rows, resolutions);
      setLastCommit(result);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "Native transaction committed",
        description: `Batch ${result.batch_id.slice(0, 8)} saved ${result.accepted_count} fixture change(s)`,
      });
    } catch (error) {
      toast({
        title: "Commit blocked",
        description: error instanceof Error ? error.message : "Native transaction did not commit",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const runDownloadTemplate = async () => {
    setBusy("template");
    try {
      await downloadNativeIngestionTemplate();
    } catch (error) {
      toast({
        title: "Template download failed",
        description: error instanceof Error ? error.message : "Template could not be downloaded",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const runStageImage = async (
    row: NativeIngestionRow,
    imageSlot: "image_1_url" | "image_2_url",
    file: File,
  ) => {
    if (!sessionId) return;
    setBusy("image");
    try {
      const staged = await stageNativeIngestionImage(sessionId, context, row, imageSlot, file);
      setRows((current) => current.map((item) => (
        item.row_id === row.row_id
          ? {
            ...item,
            [imageSlot]: staged.public_url,
            image_storage: {
              ...(item.image_storage || {}),
              [imageSlot]: staged.storage,
            },
            validation_state: "Image staged, validate before commit",
          }
          : item
      )));
      toast({ title: "Image staged", description: "Reference image will promote only if commit succeeds" });
    } catch (error) {
      toast({
        title: "Image staging failed",
        description: error instanceof Error ? error.message : "Image could not be staged",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 text-slate-950">
      <div className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-primary-foreground">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Native Fixture Ingestion Workspace</h2>
            <p className="truncate text-xs text-slate-500">
              Session {sessionId ? sessionId.slice(0, 8) : "starting"}
              {sessionExpiresAt ? ` · expires ${new Date(sessionExpiresAt).toLocaleString()}` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lastCommit ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Batch {lastCommit.batch_id.slice(0, 8)}
            </Badge>
          ) : null}
          {isBusy ? (
            <span className="inline-flex items-center gap-2 text-xs text-slate-500">
              <MorphLoader size={15} />
              {busyLabel}
            </span>
          ) : null}
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="shrink-0 border-b bg-slate-50 px-4 py-3">
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          <ContextInput label="Project No" value={context.project_no} onChange={(value) => updateContext({ project_no: value })} />
          <ContextInput label="Customer" value={context.customer} onChange={(value) => updateContext({ customer: value })} />
          <ContextInput label="Department" value={context.department_name || context.department_id} readOnly />
          <ContextInput label="Vendor" value={context.vendor} onChange={(value) => updateContext({ vendor: value })} />
          <ContextInput label="Operational Batch" value={context.operational_batch} onChange={(value) => updateContext({ operational_batch: value })} />
          <ContextInput label="Revision" value={context.revision} onChange={(value) => updateContext({ revision: value })} />
          <ContextInput label="Upload Source" value={context.upload_source} readOnly />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void runImport(file);
            }
            event.currentTarget.value = "";
          }}
        />
        <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => fileInputRef.current?.click()}>
          <UploadCloud className="mr-2 h-4 w-4" />
          Import Excel
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={runPasteFromClipboard}>
          <Clipboard className="mr-2 h-4 w-4" />
          Paste From Clipboard
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={runDownloadTemplate}>
          <Download className="mr-2 h-4 w-4" />
          Download Template
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isBusy || !contextReady(context)} onClick={runValidate}>
          <ShieldCheck className="mr-2 h-4 w-4" />
          Validate
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isBusy || !sessionId} onClick={runSaveDraft}>
          <Save className="mr-2 h-4 w-4" />
          Save Draft
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isBusy || !sessionId || unresolvedConflictCount > 0 || !contextReady(context)}
          onClick={runCommit}
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Commit Transaction
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SummaryPill label="Rows" value={summary?.total_rows ?? rowCounts.populated} tone="slate" />
          <SummaryPill label="Safe" value={rowCounts.safe} tone="green" />
          <SummaryPill label="Warnings" value={summary?.warning_rows ?? 0} tone="amber" />
          <SummaryPill label="Conflicts" value={rowCounts.conflicts} tone="orange" />
          <SummaryPill label="Errors" value={rowCounts.errors} tone="red" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <NativeSpreadsheetGrid
          rows={rows}
          onRowsChange={(next) => {
            setRows(padRows(next, next.length));
            setLastCommit(null);
          }}
          onFocusConflict={setFocusedConflict}
          onStageImage={runStageImage}
          isBusy={isBusy}
        />
        <NativeConflictPanel
          rows={rows}
          focusedRow={focusedConflict}
          resolutions={resolutions}
          onFocusRow={setFocusedConflict}
          onResolutionChange={(rowId, resolution) => setResolutions((current) => ({
            ...current,
            [rowId]: resolution,
          }))}
        />
      </div>
    </div>
  );
}

export function NativeFixtureIngestionLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-16 justify-start gap-3 border-primary/30 bg-white px-4 py-3 text-left shadow-sm hover:bg-primary/5"
        onClick={() => setOpen(true)}
      >
        <FileSpreadsheet className="h-5 w-5 text-primary" />
        <span>
          <span className="block font-semibold">Native Fixture Upload</span>
          <span className="block text-xs text-muted-foreground">Spreadsheet ingestion workspace</span>
        </span>
      </Button>
      {open ? <WorkspaceSurface onClose={() => setOpen(false)} /> : null}
    </>
  );
}
