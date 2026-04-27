import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, UploadCloud, CheckCircle2, AlertCircle, Tag } from "lucide-react";
import { uploadDepartmentProjects } from "@/api/designApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { adminQueryKeys, analyticsQueryKeys, projectQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { generateUUID } from "@/lib/uuid";
import { cn } from "@/lib/utils";
import { parseWBSHeader, WBSParseOutcome } from "@/lib/wbsParser";

// ─── Types ───────────────────────────────────────────────────────────────────

type ProjectSheetRow = {
  id: string;
  wbs_header: string;       // raw WBS input — drives project_no, customer_name, scope_name
  project_no: string;       // parsed (read-only in UI)
  project_name: string;
  customer_name: string;    // parsed (read-only in UI)
  scope_name: string;       // parsed (read-only in UI)
  instance_count: string;
  rework_date: string;
};

type ProjectField = Exclude<keyof ProjectSheetRow, "id">;
type ProjectRowErrors = Partial<Record<ProjectField, string>>;

// ─── Constants ───────────────────────────────────────────────────────────────

const MINIMUM_VISIBLE_ROWS = 6;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createEmptyRow(): ProjectSheetRow {
  return {
    id: generateUUID(),
    wbs_header: "",
    project_no: "",
    project_name: "",
    customer_name: "",
    scope_name: "",
    instance_count: "",
    rework_date: "",
  };
}

function createInitialRows() {
  return Array.from({ length: MINIMUM_VISIBLE_ROWS }, () => createEmptyRow());
}

function isBlankRow(row: ProjectSheetRow) {
  return Object.entries(row)
    .filter(([key]) => key !== "id")
    .every(([, value]) => !String(value || "").trim());
}

function normalizeDateInput(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  const slashMatch = trimmedValue.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
  }

  const isoMatch = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year}`;
  }

  return trimmedValue;
}

function isValidDateInput(value: string) {
  if (!value.trim()) {
    return true;
  }

  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return false;
  }

  const [, day, month, year] = match;
  const parsedDate = new Date(`${year}-${month}-${day}T00:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return false;
  }

  return (
    parsedDate.getFullYear() === Number(year) &&
    parsedDate.getMonth() === Number(month) - 1 &&
    parsedDate.getDate() === Number(day)
  );
}

function validateRow(row: ProjectSheetRow): ProjectRowErrors {
  const errors: ProjectRowErrors = {};

  // WBS header must parse successfully before anything else
  if (!row.wbs_header.trim()) {
    errors.wbs_header = "Required";
  } else {
    const result = parseWBSHeader(row.wbs_header);
    if (!result.valid) {
      errors.wbs_header = result.message;
    }
  }

  if (!row.project_name.trim()) {
    errors.project_name = "Required";
  }

  if (!row.instance_count.trim()) {
    errors.instance_count = "Required";
  } else if (!/^\d+$/.test(row.instance_count.trim()) || Number(row.instance_count.trim()) <= 0) {
    errors.instance_count = "Use a positive integer";
  }

  if (row.rework_date.trim() && !isValidDateInput(row.rework_date)) {
    errors.rework_date = "Use DD/MM/YYYY";
  }

  return errors;
}

function looksLikeHeader(columns: string[]) {
  const headerText = columns.join(" ").toLowerCase();
  return (
    headerText.includes("project no") &&
    headerText.includes("project name") &&
    headerText.includes("customer") &&
    headerText.includes("scope")
  );
}

function parseExcelRows(text: string) {
  const parsedRows = text
    .split(/\r?\n/)
    .map((line) => line.split("\t").map((cell) => cell.trim()))
    .filter((columns) => columns.some((cell) => cell));

  if (!parsedRows.length) {
    return [];
  }

  const dataRows = looksLikeHeader(parsedRows[0]) ? parsedRows.slice(1) : parsedRows;

  return dataRows.map((columns) => ({
    id: generateUUID(),
    wbs_header: "",
    project_no: columns[0] || "",
    project_name: columns[1] || "",
    customer_name: columns[2] || "",
    scope_name: columns[3] || "",
    instance_count: columns[4] || "",
    rework_date: normalizeDateInput(columns[5] || ""),
  }));
}

// ─── WBS Preview Chip ─────────────────────────────────────────────────────────

function WBSPreviewChip({ result }: { result: WBSParseOutcome | null }) {
  if (!result) return null;

  if (!result.valid) {
    return (
      <div className="flex items-start gap-1.5 mt-1.5 px-2 py-1.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
        <span>{result.message}</span>
      </div>
    );
  }

  return (
    <div className="mt-1.5 px-2 py-1.5 rounded-md bg-primary/8 border border-primary/20 text-xs space-y-0.5">
      <div className="flex items-center gap-1 text-primary font-medium mb-1">
        <CheckCircle2 className="h-3 w-3" />
        <span>Parsed</span>
      </div>
      <div className="grid grid-cols-1 gap-0.5 text-foreground/80">
        <div>
          <span className="text-muted-foreground">Project: </span>
          <span className="font-semibold text-foreground">{result.project_code}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Scope: </span>
          <span className="font-semibold text-foreground">{result.scope_name}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Company: </span>
          <span className="font-semibold text-foreground">{result.company_name}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProjectUploadCard() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pasteBuffer, setPasteBuffer] = useState("");
  const [rows, setRows] = useState<ProjectSheetRow[]>(createInitialRows);
  const [rowErrors, setRowErrors] = useState<Record<string, ProjectRowErrors>>({});
  /**
   * Live WBS parse results per row — computed on every keystroke for instant inline preview.
   * Key = row.id
   */
  const [wbsResults, setWbsResults] = useState<Record<string, WBSParseOutcome | null>>({});

  const uploadMutation = useMutation({
    mutationFn: uploadDepartmentProjects,
    onSuccess: async (uploadSummary) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjectsRoot }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogs }),
        queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
      ]);

      setRows(createInitialRows());
      setPasteBuffer("");
      setRowErrors({});
      setWbsResults({});
      setOpen(false);

      toast({
        title: "Design projects uploaded",
        description:
          uploadSummary.skipped_rows.length > 0
            ? `${uploadSummary.success_count} row${uploadSummary.success_count === 1 ? "" : "s"} processed, ${uploadSummary.skipped_rows.length} skipped. ${uploadSummary.skipped_rows[0].reason}`
            : `${uploadSummary.success_count} row${uploadSummary.success_count === 1 ? "" : "s"} processed for the Design department.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Could not upload design project data",
        variant: "destructive",
      });
    },
  });

  const nonEmptyRows = rows.filter((row) => !isBlankRow(row));

  // ── Cell change handler ───────────────────────────────────────────────────

  const handleCellChange = (rowId: string, field: ProjectField, value: string) => {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.id !== rowId) return row;

        if (field === "wbs_header") {
          // Parse WBS and auto-fill derived fields
          const result = value.trim() ? parseWBSHeader(value) : null;
          setWbsResults((prev) => ({ ...prev, [rowId]: result }));

          const derived =
            result && result.valid
              ? {
                  project_no: result.project_code,
                  customer_name: result.company_name,
                  scope_name: result.scope_name,
                }
              : {
                  project_no: "",
                  customer_name: "",
                  scope_name: "",
                };

          return { ...row, wbs_header: value, ...derived };
        }

        return {
          ...row,
          [field]: field === "rework_date" ? normalizeDateInput(value) : value,
        };
      }),
    );

    // Clear field-level error on change
    setRowErrors((currentErrors) => {
      if (!currentErrors[rowId]?.[field]) return currentErrors;
      return {
        ...currentErrors,
        [rowId]: { ...currentErrors[rowId], [field]: undefined },
      };
    });
  };

  // ── Paste import (legacy tab-delimited paste) ─────────────────────────────

  const handlePasteImport = () => {
    const parsedRows = parseExcelRows(pasteBuffer);

    if (!parsedRows.length) {
      toast({
        title: "Nothing to paste",
        description: "Paste copied Excel rows into the box first.",
        variant: "destructive",
      });
      return;
    }

    const nextRows = [...parsedRows];
    while (nextRows.length < MINIMUM_VISIBLE_ROWS) {
      nextRows.push(createEmptyRow());
    }

    setRows(nextRows);
    setRowErrors({});
    setWbsResults({});
    setPasteBuffer("");

    toast({
      title: "Rows pasted",
      description: `${parsedRows.length} row${parsedRows.length === 1 ? "" : "s"} loaded into the sheet.`,
    });
  };

  // ── Row management ────────────────────────────────────────────────────────

  const handleAddRow = () => {
    setRows((currentRows) => [...currentRows, createEmptyRow()]);
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((currentRows) => {
      const remainingRows = currentRows.filter((row) => row.id !== rowId);
      return remainingRows.length > 0 ? remainingRows : [createEmptyRow()];
    });
    setRowErrors((currentErrors) => {
      if (!currentErrors[rowId]) return currentErrors;
      const nextErrors = { ...currentErrors };
      delete nextErrors[rowId];
      return nextErrors;
    });
    setWbsResults((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  };

  const handleReset = () => {
    setRows(createInitialRows());
    setPasteBuffer("");
    setRowErrors({});
    setWbsResults({});
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = () => {
    if (nonEmptyRows.length === 0) {
      toast({
        title: "No project rows",
        description: "Add at least one design project row before submitting.",
        variant: "destructive",
      });
      return;
    }

    const nextErrors = nonEmptyRows.reduce<Record<string, ProjectRowErrors>>((errors, row) => {
      const rowValidation = validateRow(row);
      if (Object.keys(rowValidation).length > 0) {
        errors[row.id] = rowValidation;
      }
      return errors;
    }, {});

    setRowErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      toast({
        title: "Validation failed",
        description: "Fix all WBS header errors before uploading.",
        variant: "destructive",
      });
      return;
    }

    uploadMutation.mutate(
      nonEmptyRows.map((row) => ({
        project_no: row.project_no.trim(),
        project_name: row.project_name.trim(),
        customer_name: row.customer_name.trim(),
        scope_name: row.scope_name.trim(),
        instance_count: Number(row.instance_count.trim()),
        rework_date: row.rework_date.trim() || null,
      })),
    );
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Card className="animate-fade-in border-primary/20">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-sm">Design Project Intake</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Upload Design department project rows using WBS Header format with Excel paste support.
            </p>
          </div>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button type="button" className="h-9 text-sm shrink-0">
                <UploadCloud className="h-4 w-4 mr-2" />
                Upload Design Project
              </Button>
            </SheetTrigger>

            <SheetContent side="bottom" className="h-[92vh] max-h-[92vh] overflow-hidden px-0">
              <div className="flex h-full flex-col">
                <SheetHeader className="border-b px-6 pb-4">
                  <SheetTitle className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-primary" />
                    Upload Design Project
                  </SheetTitle>
                  <SheetDescription>
                    Enter a WBS Header per row — it auto-parses into Project Code, Scope, and Company.
                    Format:{" "}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">
                      WBS-&#123;ProjectCode&#125;-&#123;ScopeName&#125;_&#123;CompanyName&#125;
                    </code>
                  </SheetDescription>
                </SheetHeader>

                {/* Legacy paste area */}
                <div className="grid gap-4 border-b px-6 py-4 lg:grid-cols-[1.4fr_auto]">
                  <div className="space-y-2">
                    <Label className="text-xs">Paste From Excel (Legacy Tab-Delimited)</Label>
                    <Textarea
                      value={pasteBuffer}
                      onChange={(event) => setPasteBuffer(event.target.value)}
                      placeholder={"Project No\tProject Name\tCustomer Name\tScope Name\tInstance\tRework Date"}
                      className="min-h-24 resize-none font-mono text-xs"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button type="button" variant="outline" className="h-9 text-sm" onClick={handlePasteImport}>
                      Paste Rows
                    </Button>
                    <Button type="button" variant="ghost" className="h-9 text-sm" onClick={handleReset}>
                      Clear Sheet
                    </Button>
                  </div>
                </div>

                {/* Sheet table */}
                <div className="flex-1 overflow-auto px-6 py-4">
                  <div className="rounded-xl border bg-background">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead className="min-w-[320px]">
                            <span className="flex items-center gap-1">
                              <Tag className="h-3 w-3 text-primary" />
                              WBS Header *
                            </span>
                          </TableHead>
                          <TableHead className="w-48">Project Name *</TableHead>
                          <TableHead className="w-28">Instance *</TableHead>
                          <TableHead className="w-36">Rework Date</TableHead>
                          <TableHead className="w-12 text-right"> </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row, index) => {
                          const errors = rowErrors[row.id] || {};
                          const wbsResult = wbsResults[row.id] ?? null;

                          return (
                            <TableRow
                              key={row.id}
                              className={cn(
                                "align-top",
                                errors.wbs_header && "bg-destructive/5",
                              )}
                            >
                              {/* Row number */}
                              <TableCell className="text-xs text-muted-foreground pt-3">{index + 1}</TableCell>

                              {/* WBS Header cell — main input */}
                              <TableCell className="p-2">
                                <Input
                                  id={`wbs-header-${row.id}`}
                                  value={row.wbs_header}
                                  onChange={(event) => handleCellChange(row.id, "wbs_header", event.target.value)}
                                  placeholder="WBS-PARC2600M001-Fuel Tank weld Line_Belrise Industries Limited"
                                  className={cn(
                                    "h-9 text-sm font-mono",
                                    errors.wbs_header && "border-destructive focus-visible:ring-destructive",
                                    wbsResult?.valid && "border-primary/50 focus-visible:ring-primary/50",
                                  )}
                                  aria-describedby={`wbs-preview-${row.id}`}
                                />
                                <div id={`wbs-preview-${row.id}`}>
                                  <WBSPreviewChip result={wbsResult} />
                                </div>
                              </TableCell>

                              {/* Project Name */}
                              <TableCell className="p-2 pt-3">
                                <Input
                                  id={`project-name-${row.id}`}
                                  value={row.project_name}
                                  onChange={(event) => handleCellChange(row.id, "project_name", event.target.value)}
                                  className={cn(
                                    "h-9 text-sm",
                                    errors.project_name && "border-destructive focus-visible:ring-destructive",
                                  )}
                                />
                                {errors.project_name && (
                                  <p className="text-destructive text-xs mt-1">{errors.project_name}</p>
                                )}
                              </TableCell>

                              {/* Instance count */}
                              <TableCell className="p-2 pt-3">
                                <Input
                                  id={`instance-count-${row.id}`}
                                  value={row.instance_count}
                                  onChange={(event) => handleCellChange(row.id, "instance_count", event.target.value)}
                                  inputMode="numeric"
                                  className={cn(
                                    "h-9 text-sm",
                                    errors.instance_count && "border-destructive focus-visible:ring-destructive",
                                  )}
                                />
                                {errors.instance_count && (
                                  <p className="text-destructive text-xs mt-1">{errors.instance_count}</p>
                                )}
                              </TableCell>

                              {/* Rework date */}
                              <TableCell className="p-2 pt-3">
                                <Input
                                  id={`rework-date-${row.id}`}
                                  value={row.rework_date}
                                  onChange={(event) => handleCellChange(row.id, "rework_date", event.target.value)}
                                  placeholder="DD/MM/YYYY"
                                  className={cn(
                                    "h-9 text-sm",
                                    errors.rework_date && "border-destructive focus-visible:ring-destructive",
                                  )}
                                />
                                {errors.rework_date && (
                                  <p className="text-destructive text-xs mt-1">{errors.rework_date}</p>
                                )}
                              </TableCell>

                              {/* Remove row */}
                              <TableCell className="p-2 pt-3">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9"
                                  onClick={() => handleRemoveRow(row.id)}
                                  aria-label={`Remove row ${index + 1}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t px-6 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="text-xs text-muted-foreground">
                      {nonEmptyRows.length} populated row{nonEmptyRows.length === 1 ? "" : "s"} ready for validation.
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button type="button" variant="outline" className="h-9 text-sm" onClick={handleAddRow}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Row
                      </Button>
                      <Button
                        type="button"
                        className="h-9 text-sm"
                        onClick={handleSubmit}
                        disabled={uploadMutation.isPending}
                      >
                        <UploadCloud className="h-4 w-4 mr-2" />
                        {uploadMutation.isPending ? "Uploading..." : "Submit Projects"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <p className="text-xs text-muted-foreground">
          WBS Header auto-fills Project Code, Scope, and Company. Rework Date is optional.
        </p>
      </CardContent>
    </Card>
  );
}
