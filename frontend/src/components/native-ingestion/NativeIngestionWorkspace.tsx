import React, { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileSpreadsheet,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { fetchAllDepartments } from "@/api/adminApi";
import {
  commitNativeIngestion,
  createNativeIngestionSession,
  downloadNativeIngestionTemplate,
  importNativeIngestionExcel,
  pasteNativeIngestionClipboard,
  stageNativeIngestionImage,
  validateNativeIngestion,
} from "@/api/nativeIngestionApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MorphLoader } from "@/components/ui/morph-loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/useAuth";
import { cn } from "@/lib/utils";
import type {
  NativeCommitResponse,
  NativeIngestionContext,
  NativeIngestionRow,
  NativeUploadMode,
  NativeValidationSummary,
} from "./NativeIngestionTypes";
import { NativeSpreadsheetGrid } from "./NativeSpreadsheetGrid";
import {
  buildInitialRows,
  contextReady,
  defaultNativeContext,
  formatProjectIdentity,
  hydrateProjectIdentityContext,
  mergeValidationRows,
  nativeRowHasData,
  normalizeUploadMode,
  padRows,
} from "./nativeIngestionUtils";

type BusyAction = "open" | "import" | "paste" | "template" | "validate" | "commit" | "image" | null;

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "red" | "slate";
}) {
  const toneClass = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
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
          <span className="block text-xs text-muted-foreground">Production spreadsheet workspace</span>
        </span>
      </Button>
      {open ? <WorkspaceSurface onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ContextInput({
  label,
  value,
  onChange,
  readOnly,
  placeholder,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="min-w-0">
      <Label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">{label}</Label>
      <Input
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
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
  const [context, setContext] = useState<NativeIngestionContext>(() => defaultNativeContext(user));
  const [rows, setRows] = useState<NativeIngestionRow[]>(() => buildInitialRows());
  const [summary, setSummary] = useState<NativeValidationSummary | null>(null);
  const [busy, setBusy] = useState<BusyAction>("open");
  const [lastCommit, setLastCommit] = useState<NativeCommitResponse | null>(null);

  const needsDepartmentSelector = !context.department_id;
  const departmentsQuery = useQuery({
    queryKey: ["native-ingestion", "departments"],
    queryFn: fetchAllDepartments,
    enabled: needsDepartmentSelector,
    staleTime: 5 * 60_000,
  });

  React.useEffect(() => {
    if (sessionId) {
      return;
    }

    let mounted = true;
    setBusy("open");
    void createNativeIngestionSession(context)
      .then((session) => {
        if (!mounted) return;
        setSessionId(session.session_id);
        setContext((current) => ({
          ...current,
          ...session.context,
          project_identity: current.project_identity || session.context.project_identity || formatProjectIdentity(session.context),
          upload_mode: normalizeUploadMode(current.upload_mode || session.context.upload_mode),
        }));
        setRows(padRows(session.rows?.length ? session.rows : rows));
      })
      .catch((error) => {
        toast({
          title: "Native workspace failed to open",
          description: error instanceof Error ? error.message : "Could not create ingestion session",
          variant: "destructive",
        });
      })
      .finally(() => mounted && setBusy(null));

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create one backend session per workspace open
  }, [sessionId]);

  const busyLabel = busy ? busy.charAt(0).toUpperCase() + busy.slice(1) : "";
  const isBusy = busy !== null;
  const rowCounts = useMemo(() => {
    const populated = rows.filter(nativeRowHasData).length;
    const duplicateRows = rows.filter((row) => row.classification === "DUPLICATE").length;
    const invalidRows = rows.filter((row) => row.severity === "error").length;
    return {
      populated,
      valid: Math.max(0, populated - invalidRows),
      invalid: invalidRows,
      duplicate: duplicateRows,
    };
  }, [rows]);

  const updateContext = (patch: Partial<NativeIngestionContext>) => {
    setContext((current) => ({ ...current, ...patch }));
    setSummary(null);
    setLastCommit(null);
  };

  const updateProjectIdentity = (value: string) => {
    setContext((current) => hydrateProjectIdentityContext(current, value));
    setSummary(null);
    setLastCommit(null);
  };

  const requireSession = () => {
    if (sessionId) return true;
    toast({
      title: "Department required",
      description: "Choose a department before starting the native ingestion session.",
      variant: "destructive",
    });
    return false;
  };

  const runImport = async (file: File) => {
    if (!requireSession()) return;
    setBusy("import");
    try {
      const result = await importNativeIngestionExcel(sessionId, context, file);
      setRows(padRows(result.rows));
      setSummary(null);
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
    if (!requireSession()) return;
    setBusy("paste");
    try {
      const text = await navigator.clipboard.readText();
      const result = await pasteNativeIngestionClipboard(sessionId, context, text);
      setRows(padRows(result.rows));
      setSummary(null);
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
    if (!requireSession()) return;
    setBusy("validate");
    try {
      const validation = await validateNativeIngestion(sessionId, context, rows);
      setContext((current) => ({
        ...current,
        ...validation.context,
        upload_mode: normalizeUploadMode(current.upload_mode),
      }));
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

  const runCommit = async () => {
    if (!requireSession()) return;
    setBusy("commit");
    try {
      const result = await commitNativeIngestion(sessionId, context, rows);
      setLastCommit(result);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "Native transaction committed",
        description: result.batch_id
          ? `Batch ${result.batch_id.slice(0, 8)} saved ${result.accepted_count} fixture change(s)`
          : `${result.accepted_count} fixture change(s) accepted`,
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

  const runStageImage = async (row: NativeIngestionRow, file: File) => {
    if (!requireSession()) return;
    setBusy("image");
    try {
      const staged = await stageNativeIngestionImage(sessionId, context, row, file);
      setRows((current) => current.map((item) => (
        item.row_id === row.row_id
          ? {
            ...item,
            reference_image_url: staged.public_url,
            image_storage: {
              ...(item.image_storage || {}),
              reference_image_url: staged.storage,
            },
            storage_warning: staged.warning || null,
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

  const departmentOptions = (departmentsQuery.data ?? []).filter((department) => department.is_active !== false);
  const updateDepartment = (departmentId: string) => {
    const department = departmentOptions.find((item) => item.id === departmentId);
    updateContext({
      department_id: departmentId,
      department_name: department?.name || departmentId,
    });
  };

  const updateUploadMode = (value: NativeUploadMode) => {
    updateContext({ upload_mode: value });
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
              Session {sessionId ? sessionId.slice(0, 8) : "not started"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lastCommit?.batch_id ? (
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
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
          <ContextInput
            label="Project"
            value={context.project_identity}
            placeholder="PARC001 - Project - Customer"
            onChange={updateProjectIdentity}
          />
          <ContextInput label="Project Code" value={context.project_code} readOnly />
          <ContextInput label="Project Name" value={context.project_name} readOnly />
          <ContextInput label="Customer" value={context.customer_name} readOnly />
          {needsDepartmentSelector ? (
            <div className="min-w-0">
              <Label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Department</Label>
              <Select
                value={context.department_id || undefined}
                onValueChange={updateDepartment}
                disabled={departmentsQuery.isLoading || departmentOptions.length === 0}
              >
                <SelectTrigger className="h-9 bg-white text-sm">
                  <SelectValue placeholder={departmentsQuery.isLoading ? "Loading departments" : "Select department"} />
                </SelectTrigger>
                <SelectContent>
                  {departmentOptions.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <ContextInput label="Department" value={context.department_name || context.department_id} readOnly />
          )}
          <div className="min-w-0">
            <Label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Upload Mode</Label>
            <Select value={context.upload_mode} onValueChange={(value) => updateUploadMode(normalizeUploadMode(value))}>
              <SelectTrigger className="h-9 bg-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_project_update">Full Project Update</SelectItem>
                <SelectItem value="fixture_delta">Fixture Delta</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
        <Button type="button" size="sm" variant="outline" disabled={isBusy || !sessionId} onClick={() => fileInputRef.current?.click()}>
          <UploadCloud className="mr-2 h-4 w-4" />
          Import Excel
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isBusy || !sessionId} onClick={runPasteFromClipboard}>
          <Clipboard className="mr-2 h-4 w-4" />
          Paste From Clipboard
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={runDownloadTemplate}>
          <Download className="mr-2 h-4 w-4" />
          Download Template
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isBusy || !sessionId || !contextReady(context)} onClick={runValidate}>
          <ShieldCheck className="mr-2 h-4 w-4" />
          Validate
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isBusy || !sessionId || !contextReady(context)}
          onClick={runCommit}
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Commit Transaction
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SummaryPill label="Rows" value={summary?.total_rows ?? rowCounts.populated} tone="slate" />
          <SummaryPill label="Valid" value={summary?.valid_rows ?? rowCounts.valid} tone="green" />
          <SummaryPill label="Duplicates" value={summary?.duplicate_rows ?? rowCounts.duplicate} tone="amber" />
          <SummaryPill label="Invalid" value={summary?.invalid_rows ?? rowCounts.invalid} tone="red" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <NativeSpreadsheetGrid
          rows={rows}
          onRowsChange={(next) => {
            setRows(padRows(next, next.length));
            setLastCommit(null);
          }}
          onStageImage={runStageImage}
          isBusy={isBusy}
        />
      </div>
    </div>
  );
}

