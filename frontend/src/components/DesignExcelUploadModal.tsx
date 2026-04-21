import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UploadCloud, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet } from "lucide-react";
import { uploadDesignExcel, confirmDesignUpload } from "@/api/designApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DesignExcelUploadResponse, DesignExcelPreviewRow } from "@/types";
import { projectQueryKeys, taskQueryKeys, adminQueryKeys, analyticsQueryKeys } from "@/lib/queryKeys";

export function DesignExcelUploadModal() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DesignExcelUploadResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "incoming" | "existing">>({});

  const resetState = () => {
    setFile(null);
    setPreview(null);
    setDecisions({});
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetState();
    }
  };

  const uploadMutation = useMutation({
    mutationFn: uploadDesignExcel,
    onSuccess: (data) => {
      setPreview(data);
      // Initialize decisions for conflicts
      const initialDecisions: Record<string, "incoming" | "existing"> = {};
      data.preview.conflicts.forEach((c) => {
        initialDecisions[c.incoming.fixture_no] = "existing"; // safe default
      });
      setDecisions(initialDecisions);
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to parse Excel file",
        variant: "destructive",
      });
      resetState();
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      uploadMutation.mutate(selected);
    }
  };

  const handleConfirm = () => {
    if (!preview) return;

    // Collect resolved items
    const resolved_items: Array<{ data: DesignExcelPreviewRow }> = [];

    // Add accepted (New, Update QTY)
    preview.preview.accepted.forEach(item => {
      resolved_items.push({ data: item.incoming });
    });

    // Add resolved conflicts
    preview.preview.conflicts.forEach(item => {
      const decision = decisions[item.incoming.fixture_no];
      if (decision === "incoming") {
        resolved_items.push({ data: item.incoming });
      } else {
        resolved_items.push({ data: item.existing });
      }
    });

    confirmMutation.mutate({
      file_info: preview.file_info,
      resolved_items,
      rejected_items: preview.preview.rejected
    });
  };

  const hasUnresolvedConflicts = preview?.preview.conflicts.some(c => !decisions[c.incoming.fixture_no]);

  return (
    <Card className="animate-fade-in border-foreground/10 bg-transparent shadow-none w-full mb-6">
      <CardHeader className="p-4 flex flex-row items-center justify-between pb-2 bg-gradient-to-r from-primary/10 to-transparent rounded-t-xl border-b border-primary/20">
        <div>
          <h3 className="font-bold text-lg tracking-tight">Design Department Ingestion</h3>
          <p className="text-sm text-muted-foreground">
            Strict Excel uploads ensuring accurate fixture generation.
          </p>
        </div>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button className="h-10 px-5 shadow-sm bg-primary hover:bg-primary/90 transition-all font-semibold rounded-full">
              <UploadCloud className="h-4 w-4 mr-2" />
              Upload Spreadhseet
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col p-6 rounded-2xl overflow-hidden glass">
            <DialogHeader className="mb-2 shrink-0">
              <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                <FileSpreadsheet className="h-6 w-6 text-primary" /> 
                Fixture Spreadsheet Ingestion
              </DialogTitle>
              <DialogDescription>
                Upload a structured <code>.xlsx</code> file following the strict Design department format.
              </DialogDescription>
            </DialogHeader>

            {!preview ? (
              <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-muted rounded-xl bg-card/30">
                <FileSpreadsheet className="h-16 w-16 text-muted-foreground mb-4 opacity-50" />
                <p className="text-sm text-muted-foreground font-medium mb-6">Select a valid .xlsx file to begin validation</p>
                <div className="relative">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={uploadMutation.isPending}
                  />
                  <Button variant="outline" disabled={uploadMutation.isPending} className="bg-background shadow-sm hover:border-primary/50 transition-colors">
                    {uploadMutation.isPending ? "Validating..." : "Choose File"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-background/50 rounded-xl border">
                <div className="p-4 border-b bg-card">
                  <h4 className="font-semibold text-lg">{preview.file_info.project_code} - {preview.file_info.scope_name_display}</h4>
                  <p className="text-sm text-muted-foreground">{preview.file_info.company_name}</p>
                </div>
                
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-6">
                    {/* ✅ Accepted */}
                    {preview.preview.accepted.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="flex items-center gap-2 font-semibold text-green-600 dark:text-green-400 border-b pb-2">
                          <CheckCircle2 className="h-5 w-5" /> 
                          Accepted ({preview.preview.accepted.length})
                        </h5>
                        <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
                          {preview.preview.accepted.map((item, idx) => (
                            <div key={idx} className="p-3 border rounded-lg bg-green-50/50 dark:bg-green-950/20 text-sm">
                              <div className="font-medium">{item.incoming.fixture_no}</div>
                              <div className="text-muted-foreground text-xs">{item.incoming.part_name} • Type: {item.incoming.fixture_type}</div>
                              <div className="mt-1">
                                {item.type === 'NEW' ? (
                                  <span className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300 px-2 py-0.5 rounded text-xs font-semibold">NEW</span>
                                ) : (
                                  <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded text-xs font-semibold">QTY UPDATE ({item.existing?.qty} → {item.incoming.qty})</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ⚠️ Conflicts */}
                    {preview.preview.conflicts.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="flex items-center gap-2 font-semibold text-orange-600 dark:text-orange-400 border-b pb-2">
                          <AlertTriangle className="h-5 w-5" /> 
                          Conflicts Required User Decision ({preview.preview.conflicts.length})
                        </h5>
                        <div className="space-y-3">
                          {preview.preview.conflicts.map((conflict, idx) => (
                            <div key={idx} className="p-4 border border-orange-200 dark:border-orange-900/50 rounded-lg bg-orange-50/30 dark:bg-orange-950/10">
                              <div className="flex justify-between items-start mb-3">
                                <div>
                                  <div className="font-medium">{conflict.incoming.fixture_no}</div>
                                  <div className="text-xs text-orange-700 dark:text-orange-300 font-semibold uppercase">{conflict.type.replace('_', ' ')}</div>
                                </div>
                                <div className="text-xs text-muted-foreground">Row {conflict.incoming.row_number}</div>
                              </div>
                              
                              <RadioGroup
                                value={decisions[conflict.incoming.fixture_no]}
                                onValueChange={(val: "incoming" | "existing") => setDecisions(prev => ({...prev, [conflict.incoming.fixture_no]: val}))}
                                className="grid md:grid-cols-2 gap-3"
                              >
                                <div className="border rounded-md p-3 relative cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                  <RadioGroupItem value="existing" id={`existing-${conflict.incoming.fixture_no}`} className="absolute top-3 right-3" />
                                  <Label htmlFor={`existing-${conflict.incoming.fixture_no}`} className="cursor-pointer">
                                    <div className="font-semibold text-sm mb-1 text-muted-foreground">Keep Existing</div>
                                    <div className="text-xs space-y-1">
                                      <div>Part: <span className="font-medium text-foreground">{conflict.existing.part_name}</span></div>
                                      <div>Type: <span className="font-medium text-foreground">{conflict.existing.fixture_type}</span></div>
                                      <div>OP: <span className="font-medium text-foreground">{conflict.existing.op_no}</span></div>
                                    </div>
                                  </Label>
                                </div>
                                <div className="border border-primary/20 rounded-md p-3 relative cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                                  <RadioGroupItem value="incoming" id={`incoming-${conflict.incoming.fixture_no}`} className="absolute top-3 right-3" />
                                  <Label htmlFor={`incoming-${conflict.incoming.fixture_no}`} className="cursor-pointer">
                                    <div className="font-semibold text-sm mb-1 text-primary">Replace with Incoming</div>
                                    <div className="text-xs space-y-1">
                                      <div>Part: <span className="font-medium text-foreground">{conflict.incoming.part_name}</span></div>
                                      <div>Type: <span className="font-medium text-foreground">{conflict.incoming.fixture_type}</span></div>
                                      <div>OP: <span className="font-medium text-foreground">{conflict.incoming.op_no}</span></div>
                                    </div>
                                  </Label>
                                </div>
                              </RadioGroup>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ❌ Rejected */}
                    {preview.preview.rejected.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="flex items-center gap-2 font-semibold text-red-600 dark:text-red-400 border-b pb-2">
                          <XCircle className="h-5 w-5" /> 
                          Rejected Rows ({preview.preview.rejected.length})
                        </h5>
                        <div className="space-y-2">
                          {preview.preview.rejected.map((rej, idx) => (
                            <div key={idx} className="p-3 border border-red-200 dark:border-red-900/50 rounded-lg bg-red-50/50 dark:bg-red-950/20 text-sm flex justify-between">
                              <span className="font-bold text-red-700 dark:text-red-400 w-16">Row {rej.row_number}</span>
                              <span className="text-red-600 dark:text-red-300 flex-1">{rej.error_message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                
                <div className="p-4 border-t bg-muted/30 flex justify-between items-center shrink-0">
                  <Button variant="ghost" onClick={resetState}>Cancel & Reload</Button>
                  <Button 
                    onClick={handleConfirm} 
                    disabled={confirmMutation.isPending || hasUnresolvedConflicts}
                    className="min-w-32 bg-primary hover:bg-primary/90"
                  >
                    {confirmMutation.isPending ? "Committing..." : "Confirm & Save"}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
    </Card>
  );
}
