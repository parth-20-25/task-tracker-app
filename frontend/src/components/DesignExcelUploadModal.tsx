import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, ImageIcon, UploadCloud, XCircle } from "lucide-react";
import { confirmDesignUpload, uploadDesignExcel } from "@/api/designApi";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { adminQueryKeys, analyticsQueryKeys, projectQueryKeys, taskQueryKeys } from "@/lib/queryKeys";
import { DesignExcelPreviewRow, DesignExcelUploadResponse } from "@/types";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatConflictType(type: DesignExcelUploadResponse["preview"]["conflicts"][number]["type"]) {
  switch (type) {
    case "CONFLICT_PART_NAME":
      return "Part name mismatch";
    case "CONFLICT_IMAGES":
      return "Image change requires review";
    default:
      return "Fixture data mismatch";
  }
}

function ImagePreviewStrip({ row }: { row: DesignExcelPreviewRow }) {
  const images = [row.image_1_url, row.image_2_url].filter(Boolean) as string[];

  if (images.length === 0) {
    return (
      <div className="mt-3 rounded-md border border-dashed border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        No mapped images found for columns F or I.
      </div>
    );
  }

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {images.map((imageUrl, index) => (
        <div key={`${imageUrl}-${index}`} className="overflow-hidden rounded-md border bg-background">
          <img
            src={imageUrl}
            alt={`${row.fixture_no} preview ${index + 1}`}
            className="h-24 w-full object-cover"
            loading="lazy"
          />
        </div>
      ))}
    </div>
  );
}

function formatRemark(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || "—";
}

export function DesignExcelUploadModal() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DesignExcelUploadResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "incoming" | "existing">>({});
  const [isDragActive, setIsDragActive] = useState(false);

  const resetState = () => {
    setSelectedFile(null);
    setPreview(null);
    setDecisions({});
    setIsDragActive(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetState();
    }
  };

  const validateClientFile = (file: File) => {
    const hasXlsxExtension = file.name.toLowerCase().endsWith(".xlsx");

    if (!hasXlsxExtension) {
      throw new Error("Only .xlsx Excel files are allowed");
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error("Excel file must be 10 MB or smaller");
    }
  };

  const setFileForUpload = (file: File | null) => {
    if (!file) {
      return;
    }

    validateClientFile(file);
    setSelectedFile(file);
    setPreview(null);
    setDecisions({});
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDesignExcel(file),
    onSuccess: (data) => {
      setPreview(data);
      const initialDecisions: Record<string, "incoming" | "existing"> = {};
      data.preview.conflicts.forEach((conflict) => {
        initialDecisions[conflict.incoming.fixture_no] = "existing";
      });
      setDecisions(initialDecisions);
    },
    onError: (error) => {
      const description = error instanceof Error ? error.message : "Failed to process file";
      toast({
        title: "Upload failed",
        description,
        variant: "destructive",
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: confirmDesignUpload,
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogs }),
        queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all }),
      ]);

      toast({
        title: "Upload confirmed",
        description: `Successfully loaded ${data.accepted_count} fixtures.`,
      });
      setOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Confirmation failed",
        description: error instanceof Error ? error.message : "Could not complete the process",
        variant: "destructive",
      });
    },
  });

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    try {
      const nextFile = event.target.files?.[0] || null;
      setFileForUpload(nextFile);
    } catch (error) {
      toast({
        title: "Invalid file",
        description: error instanceof Error ? error.message : "Choose a valid .xlsx file",
        variant: "destructive",
      });
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);

    try {
      const nextFile = event.dataTransfer.files?.[0] || null;
      setFileForUpload(nextFile);
    } catch (error) {
      toast({
        title: "Invalid file",
        description: error instanceof Error ? error.message : "Choose a valid .xlsx file",
        variant: "destructive",
      });
    }
  };

  const handleConfirm = () => {
    if (!preview) {
      return;
    }

    const resolved_items: Array<{ data: DesignExcelPreviewRow }> = [];

    preview.preview.accepted.forEach((item) => {
      resolved_items.push({ data: item.incoming });
    });

    preview.preview.conflicts.forEach((item) => {
      const decision = decisions[item.incoming.fixture_no];
      resolved_items.push({
        data: decision === "incoming" ? item.incoming : item.existing,
      });
    });

    confirmMutation.mutate({
      file_info: preview.file_info,
      resolved_items,
      rejected_items: preview.preview.rejected,
    });
  };

  const hasUnresolvedConflicts = preview?.preview.conflicts.some((conflict) => !decisions[conflict.incoming.fixture_no]);

  return (
    <Card className="animate-fade-in mb-6 w-full border-foreground/10 bg-transparent shadow-none">
      <CardHeader className="flex flex-row items-center justify-between rounded-t-xl border-b border-primary/20 bg-gradient-to-r from-primary/10 to-transparent p-4 pb-2">
        <div>
          <h3 className="text-lg font-bold tracking-tight">Design Department Ingestion</h3>
          <p className="text-sm text-muted-foreground">
            Secure Excel upload with Python-based extraction for fixture rows and images.
          </p>
        </div>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button className="h-10 rounded-full bg-primary px-5 font-semibold shadow-sm transition-all hover:bg-primary/90">
              <UploadCloud className="mr-2 h-4 w-4" />
              Upload Design Excel
            </Button>
          </DialogTrigger>
          <DialogContent className="glass flex max-h-[90vh] min-h-0 w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-5xl">
            <DialogHeader className="shrink-0 border-b bg-background/95 p-6 pb-4 pr-12">
              <DialogTitle className="flex items-center gap-2 text-2xl font-bold">
                <FileSpreadsheet className="h-6 w-6 text-primary" />
                Fixture Spreadsheet Ingestion
              </DialogTitle>
              <DialogDescription>
                Upload a `.xlsx` workbook to extract fixture rows, map anchored images, review conflicts, and save through the main backend.
              </DialogDescription>
            </DialogHeader>

            {!preview ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="fixture-modal-scroll min-h-0 flex-1 overflow-y-auto p-6">
                  <div className="flex flex-col gap-4">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      className="hidden"
                      onChange={handleFileInputChange}
                    />

                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          fileInputRef.current?.click();
                        }
                      }}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setIsDragActive(true);
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        setIsDragActive(false);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={handleDrop}
                      className={cn(
                        "rounded-2xl border border-dashed px-6 py-10 text-center transition-colors",
                        isDragActive
                          ? "border-primary bg-primary/10"
                          : "border-border/80 bg-muted/20 hover:border-primary/60 hover:bg-primary/5",
                      )}
                    >
                      <div className="mx-auto flex max-w-xl flex-col items-center gap-3">
                        <div className="rounded-full border border-primary/20 bg-primary/10 p-4 text-primary">
                          <UploadCloud className="h-8 w-8" />
                        </div>
                        <div>
                          <p className="text-lg font-semibold">Drag and drop your Excel workbook here</p>
                          <p className="text-sm text-muted-foreground">
                            `.xlsx` only, up to 10 MB. The backend forwards the file to the private Python extraction service.
                          </p>
                        </div>
                        <Button type="button" variant="outline" className="rounded-full">
                          Choose File
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border bg-card/60 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg bg-primary/10 p-2 text-primary">
                            <FileSpreadsheet className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-medium">
                              {selectedFile ? selectedFile.name : "No file selected yet"}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {selectedFile
                                ? `${formatFileSize(selectedFile.size)} ready for extraction`
                                : "Expected layout: WBS header, fixture table, and images anchored in columns F and I."}
                            </div>
                          </div>
                        </div>
                        {selectedFile ? (
                          <Button variant="ghost" onClick={resetState}>
                            Clear
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <DialogFooter className="shrink-0 flex-col items-stretch justify-between gap-3 border-t bg-background/95 p-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ImageIcon className="h-4 w-4" />
                    Images outside columns F or I will be rejected with row-level errors.
                  </div>
                  <Button
                    onClick={() => selectedFile && uploadMutation.mutate(selectedFile)}
                    disabled={uploadMutation.isPending || !selectedFile}
                    className="min-w-36 bg-primary hover:bg-primary/90"
                  >
                    {uploadMutation.isPending ? "Extracting..." : "Upload & Preview"}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background/50">
                <div className="shrink-0 border-b bg-card p-4">
                  <h4 className="text-lg font-semibold">
                    {preview.file_info.project_code} - {preview.file_info.scope_name_display}
                  </h4>
                  <p className="text-sm text-muted-foreground">{preview.file_info.company_name}</p>
                </div>

                <div className="fixture-modal-scroll min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="space-y-6">
                    {preview.preview.accepted.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="flex items-center gap-2 border-b pb-2 font-semibold text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-5 w-5" />
                          Accepted ({preview.preview.accepted.length})
                        </h5>
                        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                          {preview.preview.accepted.map((item, index) => (
                            <div key={`${item.incoming.fixture_no}-${index}`} className="rounded-lg border bg-green-50/50 p-3 text-sm dark:bg-green-950/20">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-medium">{item.incoming.fixture_no}</div>
                                  <div className="text-xs text-muted-foreground">
                                    Row {item.incoming.row_number} • {item.incoming.part_name}
                                  </div>
                                </div>
                                <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900 dark:text-green-300">
                                  {item.type === "NEW" ? "NEW" : `QTY ${item.existing?.qty} -> ${item.incoming.qty}`}
                                </span>
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">
                                Type: <span className="font-medium text-foreground">{item.incoming.fixture_type}</span> • OP: <span className="font-medium text-foreground">{item.incoming.op_no}</span> • Qty: <span className="font-medium text-foreground">{item.incoming.qty}</span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Remark: <span className="font-medium text-foreground">{formatRemark(item.incoming.remark)}</span>
                              </div>
                              <ImagePreviewStrip row={item.incoming} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {preview.preview.conflicts.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="flex items-center gap-2 border-b pb-2 font-semibold text-orange-600 dark:text-orange-400">
                          <AlertTriangle className="h-5 w-5" />
                          Conflicts Requiring Review ({preview.preview.conflicts.length})
                        </h5>
                        <div className="space-y-3">
                          {preview.preview.conflicts.map((conflict, index) => (
                            <div key={`${conflict.incoming.fixture_no}-${index}`} className="rounded-lg border border-orange-200 bg-orange-50/30 p-4 dark:border-orange-900/50 dark:bg-orange-950/10">
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-medium">{conflict.incoming.fixture_no}</div>
                                  <div className="text-xs font-semibold uppercase text-orange-700 dark:text-orange-300">
                                    {formatConflictType(conflict.type)}
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground">Row {conflict.incoming.row_number}</div>
                              </div>

                              <RadioGroup
                                value={decisions[conflict.incoming.fixture_no]}
                                onValueChange={(value: "incoming" | "existing") => {
                                  setDecisions((current) => ({
                                    ...current,
                                    [conflict.incoming.fixture_no]: value,
                                  }));
                                }}
                                className="grid gap-3 md:grid-cols-2"
                              >
                                <div className="relative rounded-md border p-3 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                                  <RadioGroupItem value="existing" id={`existing-${conflict.incoming.fixture_no}`} className="absolute right-3 top-3" />
                                  <Label htmlFor={`existing-${conflict.incoming.fixture_no}`} className="cursor-pointer">
                                    <div className="mb-1 text-sm font-semibold text-muted-foreground">Keep Existing</div>
                                    <div className="space-y-1 text-xs">
                                      <div>Part: <span className="font-medium text-foreground">{conflict.existing.part_name}</span></div>
                                      <div>Type: <span className="font-medium text-foreground">{conflict.existing.fixture_type}</span></div>
                                      <div>OP: <span className="font-medium text-foreground">{conflict.existing.op_no}</span></div>
                                      <div>Qty: <span className="font-medium text-foreground">{conflict.existing.qty}</span></div>
                                      <div>Remark: <span className="font-medium text-foreground">{formatRemark(conflict.existing.remark)}</span></div>
                                    </div>
                                    <ImagePreviewStrip row={conflict.existing} />
                                  </Label>
                                </div>
                                <div className="relative rounded-md border border-primary/20 p-3 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                                  <RadioGroupItem value="incoming" id={`incoming-${conflict.incoming.fixture_no}`} className="absolute right-3 top-3" />
                                  <Label htmlFor={`incoming-${conflict.incoming.fixture_no}`} className="cursor-pointer">
                                    <div className="mb-1 text-sm font-semibold text-primary">Replace with Incoming</div>
                                    <div className="space-y-1 text-xs">
                                      <div>Part: <span className="font-medium text-foreground">{conflict.incoming.part_name}</span></div>
                                      <div>Type: <span className="font-medium text-foreground">{conflict.incoming.fixture_type}</span></div>
                                      <div>OP: <span className="font-medium text-foreground">{conflict.incoming.op_no}</span></div>
                                      <div>Qty: <span className="font-medium text-foreground">{conflict.incoming.qty}</span></div>
                                      <div>Remark: <span className="font-medium text-foreground">{formatRemark(conflict.incoming.remark)}</span></div>
                                    </div>
                                    <ImagePreviewStrip row={conflict.incoming} />
                                  </Label>
                                </div>
                              </RadioGroup>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {preview.preview.rejected.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="flex items-center gap-2 border-b pb-2 font-semibold text-red-600 dark:text-red-400">
                          <XCircle className="h-5 w-5" />
                          Rejected Rows ({preview.preview.rejected.length})
                        </h5>
                        <div className="space-y-2">
                          {preview.preview.rejected.map((rejected, index) => (
                            <div key={`${rejected.row_number}-${index}`} className="flex justify-between gap-3 rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/20">
                              <span className="w-20 font-bold text-red-700 dark:text-red-400">
                                {rejected.row_number > 0 ? `Row ${rejected.row_number}` : "General"}
                              </span>
                              <span className="flex-1 text-red-600 dark:text-red-300">{rejected.error_message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <DialogFooter className="shrink-0 flex-col items-stretch justify-between gap-3 border-t bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
                  <Button variant="ghost" onClick={resetState}>
                    Cancel & Reload
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    disabled={confirmMutation.isPending || hasUnresolvedConflicts}
                    className="min-w-36 bg-primary hover:bg-primary/90"
                  >
                    {confirmMutation.isPending ? "Saving..." : "Confirm & Save"}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
    </Card>
  );
}
