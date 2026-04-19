import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, UploadCloud } from "lucide-react";
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

type ProjectSheetRow = {
  id: string;
  project_no: string;
  project_name: string;
  customer_name: string;
  scope_name: string;
  instance_count: string;
  rework_date: string;
};

type ProjectField = Exclude<keyof ProjectSheetRow, "id">;
type ProjectRowErrors = Partial<Record<ProjectField, string>>;

const MINIMUM_VISIBLE_ROWS = 6;

function createEmptyRow(): ProjectSheetRow {
  return {
    id: generateUUID(),
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

  if (!row.project_no.trim()) {
    errors.project_no = "Required";
  }

  if (!row.project_name.trim()) {
    errors.project_name = "Required";
  }

  if (!row.customer_name.trim()) {
    errors.customer_name = "Required";
  }

  if (!row.scope_name.trim()) {
    errors.scope_name = "Required";
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
    project_no: columns[0] || "",
    project_name: columns[1] || "",
    customer_name: columns[2] || "",
    scope_name: columns[3] || "",
    instance_count: columns[4] || "",
    rework_date: normalizeDateInput(columns[5] || ""),
  }));
}

export function ProjectUploadCard() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pasteBuffer, setPasteBuffer] = useState("");
  const [rows, setRows] = useState<ProjectSheetRow[]>(createInitialRows);
  const [rowErrors, setRowErrors] = useState<Record<string, ProjectRowErrors>>({});

  const uploadMutation = useMutation({
    mutationFn: uploadDepartmentProjects,
    onSuccess: async (uploadSummary) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.designProjects }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogs }),
        queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
      ]);

      setRows(createInitialRows());
      setPasteBuffer("");
      setRowErrors({});
      setOpen(false);

      toast({
        title: "Design projects uploaded",
        description: uploadSummary.skipped_rows.length > 0
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

  const handleCellChange = (rowId: string, field: ProjectField, value: string) => {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        return {
          ...row,
          [field]: field === "rework_date" ? normalizeDateInput(value) : value,
        };
      }),
    );

    setRowErrors((currentErrors) => {
      if (!currentErrors[rowId]?.[field]) {
        return currentErrors;
      }

      return {
        ...currentErrors,
        [rowId]: {
          ...currentErrors[rowId],
          [field]: undefined,
        },
      };
    });
  };

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
    setPasteBuffer("");

    toast({
      title: "Rows pasted",
      description: `${parsedRows.length} row${parsedRows.length === 1 ? "" : "s"} loaded into the sheet.`,
    });
  };

  const handleAddRow = () => {
    setRows((currentRows) => [...currentRows, createEmptyRow()]);
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((currentRows) => {
      const remainingRows = currentRows.filter((row) => row.id !== rowId);
      return remainingRows.length > 0 ? remainingRows : [createEmptyRow()];
    });

    setRowErrors((currentErrors) => {
      if (!currentErrors[rowId]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[rowId];
      return nextErrors;
    });
  };

  const handleReset = () => {
    setRows(createInitialRows());
    setPasteBuffer("");
    setRowErrors({});
  };

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
        description: "Complete every required cell before uploading.",
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

  return (
    <Card className="animate-fade-in border-primary/20">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-sm">Design Project Intake</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Upload Design department project rows in a sheet layout with Excel paste support.
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
                  <SheetTitle>Upload Design Project</SheetTitle>
                  <SheetDescription>
                    Paste rows from Excel or edit directly in the sheet. Required columns are Project No, Project Name,
                    Customer Name, Scope Name, and Instance.
                  </SheetDescription>
                </SheetHeader>

                <div className="grid gap-4 border-b px-6 py-4 lg:grid-cols-[1.4fr_auto]">
                  <div className="space-y-2">
                    <Label className="text-xs">Paste From Excel</Label>
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

                <div className="flex-1 overflow-auto px-6 py-4">
                  <div className="rounded-xl border bg-background">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
                        <TableRow>
                          <TableHead className="w-14">#</TableHead>
                          <TableHead>Project No.</TableHead>
                          <TableHead>Project Name</TableHead>
                          <TableHead>Customer Name</TableHead>
                          <TableHead>Scope Name</TableHead>
                          <TableHead className="w-36">Instance</TableHead>
                          <TableHead className="w-40">Rework Date</TableHead>
                          <TableHead className="w-16 text-right"> </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row, index) => {
                          const errors = rowErrors[row.id] || {};

                          return (
                            <TableRow key={row.id}>
                              <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
                              <TableCell className="p-2">
                                <Input
                                  value={row.project_no}
                                  onChange={(event) => handleCellChange(row.id, "project_no", event.target.value)}
                                  className={cn("h-9 text-sm", errors.project_no && "border-destructive focus-visible:ring-destructive")}
                                />
                              </TableCell>
                              <TableCell className="p-2">
                                <Input
                                  value={row.project_name}
                                  onChange={(event) => handleCellChange(row.id, "project_name", event.target.value)}
                                  className={cn("h-9 text-sm", errors.project_name && "border-destructive focus-visible:ring-destructive")}
                                />
                              </TableCell>
                              <TableCell className="p-2">
                                <Input
                                  value={row.customer_name}
                                  onChange={(event) => handleCellChange(row.id, "customer_name", event.target.value)}
                                  className={cn("h-9 text-sm", errors.customer_name && "border-destructive focus-visible:ring-destructive")}
                                />
                              </TableCell>
                              <TableCell className="p-2">
                                <Input
                                  value={row.scope_name}
                                  onChange={(event) => handleCellChange(row.id, "scope_name", event.target.value)}
                                  className={cn("h-9 text-sm", errors.scope_name && "border-destructive focus-visible:ring-destructive")}
                                />
                              </TableCell>
                              <TableCell className="p-2">
                                <Input
                                  value={row.instance_count}
                                  onChange={(event) => handleCellChange(row.id, "instance_count", event.target.value)}
                                  inputMode="numeric"
                                  className={cn("h-9 text-sm", errors.instance_count && "border-destructive focus-visible:ring-destructive")}
                                />
                              </TableCell>
                              <TableCell className="p-2">
                                <Input
                                  value={row.rework_date}
                                  onChange={(event) => handleCellChange(row.id, "rework_date", event.target.value)}
                                  placeholder="DD/MM/YYYY"
                                  className={cn("h-9 text-sm", errors.rework_date && "border-destructive focus-visible:ring-destructive")}
                                />
                              </TableCell>
                              <TableCell className="p-2">
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
          Rework Date is optional. All other columns must be completed before Design project rows can be submitted.
        </p>
      </CardContent>
    </Card>
  );
}
