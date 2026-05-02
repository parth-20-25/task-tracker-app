import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, ImageIcon, UploadCloud, XCircle, Image as ImageIconSolid, Check } from "lucide-react";
import {
  confirmDesignUpload,
  uploadDesignExcel,
  pastePasteFixtureData,
  confirmPasteFixtureData,
  listFixturesByUploadBatch,
  uploadFixtureReferenceImage,
} from "@/api/designApi";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MorphLoader } from "@/components/ui/morph-loader";
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

function formatRejectedValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || "—";
}

function getRowDecisionKey(row: DesignExcelPreviewRow) {
  return `${row.fixture_no}::${row.row_number}`;
}

function ScopeDecisionControls({
  row,
  value,
  onChange,
}: {
  row: DesignExcelPreviewRow;
  value?: "add_fixture" | "skip_fixture";
  onChange: (value: "add_fixture" | "skip_fixture") => void;
}) {
  if (row.scope_status !== "AMBIGUOUS") {
    return null;
  }

  const key = getRowDecisionKey(row);

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
        This fixture does not have a clearly defined scope in remarks.
      </div>
      <div className="mt-1 text-xs text-amber-800/90 dark:text-amber-300">
        Do you want to include this fixture in PARC scope?
      </div>
      <RadioGroup
        value={value}
        onValueChange={(nextValue) => onChange(nextValue as "add_fixture" | "skip_fixture")}
        className="mt-3 grid gap-2 sm:grid-cols-2"
      >
        <div className="relative rounded-md border bg-background p-3">
          <RadioGroupItem value="add_fixture" id={`scope-add-${key}`} className="absolute right-3 top-3" />
          <Label htmlFor={`scope-add-${key}`} className="cursor-pointer">
            <div className="text-sm font-medium">Add Fixture</div>
            <div className="text-xs text-muted-foreground">Import this row into PARC scope after explicit confirmation.</div>
          </Label>
        </div>
        <div className="relative rounded-md border bg-background p-3">
          <RadioGroupItem value="skip_fixture" id={`scope-skip-${key}`} className="absolute right-3 top-3" />
          <Label htmlFor={`scope-skip-${key}`} className="cursor-pointer">
            <div className="text-sm font-medium">Skip Fixture</div>
            <div className="text-xs text-muted-foreground">Exclude this row completely from fixtures, workflow, and approvals.</div>
          </Label>
        </div>
      </RadioGroup>
    </div>
  );
}

interface BatchFixture {
  fixture_id: string;
  fixture_no: string;
  image_1_url: string | null;
  image_2_url: string | null;
  ingestion_source: string | null;
}

interface PendingPreviewImage {
  file: File;
  previewUrl: string;
}

type PendingPreviewImageMap = Record<string, {
  part?: PendingPreviewImage;
  fixture?: PendingPreviewImage;
}>;

function PreviewReferenceImageControls({
  row,
  rowKey,
  queuedImages,
  onSelect,
}: {
  row: DesignExcelPreviewRow;
  rowKey: string;
  queuedImages: PendingPreviewImageMap;
  onSelect: (rowKey: string, imageType: "part" | "fixture") => void;
}) {
  const partPreviewUrl = queuedImages[rowKey]?.part?.previewUrl || row.image_1_url || null;
  const fixturePreviewUrl = queuedImages[rowKey]?.fixture?.previewUrl || row.image_2_url || null;

  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      {[
        { imageType: "part" as const, label: "Part Image", imageUrl: partPreviewUrl },
        { imageType: "fixture" as const, label: "Fixture Image", imageUrl: fixturePreviewUrl },
      ].map((item) => (
        <div key={`${rowKey}-${item.imageType}`} className="rounded-md border bg-background/70 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</div>
          {item.imageUrl ? (
            <div className="mt-2 space-y-2">
              <img src={item.imageUrl} alt={`${row.fixture_no} ${item.label}`} className="h-20 w-full rounded border object-cover" />
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={item.imageUrl} target="_blank" rel="noreferrer">View Image</a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => onSelect(rowKey, item.imageType)}>
                  Change
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => onSelect(rowKey, item.imageType)}>
              {item.imageType === "part" ? "Upload Part Image" : "Upload Fixture Image"}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function ImageStatusBadge({ hasImage, imageType }: { hasImage: boolean; imageType: "Part" | "Fixture" }) {
  return (
    <div className={cn(
      "flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
      hasImage
        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
    )}>
      <ImageIconSolid className="h-3 w-3" />
      {imageType} {hasImage ? "✓" : "Missing"}
    </div>
  );
}

interface PostConfirmReviewProps {
  batchId: string;
  batchFixtures: BatchFixture[] | null;
  uploadingImageFor: { fixtureId: string; imageType: "part" | "fixture" } | null;
  referenceImageMutation: any;
  fileUploadRef: React.RefObject<HTMLInputElement>;
  onSelectImageUpload: (target: { fixtureId: string; imageType: "part" | "fixture" }) => void;
  onClose: () => void;
}

function PostConfirmReviewStage({
  batchId,
  batchFixtures,
  uploadingImageFor,
  referenceImageMutation,
  fileUploadRef,
  onSelectImageUpload,
  onClose,
}: PostConfirmReviewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background/50">
      <div className="shrink-0 border-b bg-card p-4">
        <h4 className="text-lg font-semibold">Upload Complete — Review & Upload Reference Images</h4>
        <p className="text-sm text-muted-foreground">
          Batch {batchId.slice(0, 8)}... — Fixtures loaded. Optional: Upload missing part/fixture reference images.
        </p>
      </div>

      <div className="fixture-modal-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {!batchFixtures ? (
          <div className="flex items-center justify-center py-12">
            <MorphLoader size={32} color="currentColor" />
          </div>
        ) : batchFixtures.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/40 p-6 text-center">
            <p className="text-sm text-muted-foreground">No fixtures in this batch.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {batchFixtures.map((fixture) => {
              const partImageMissing = !fixture.image_1_url;
              const fixtureImageMissing = !fixture.image_2_url;
              const showImageControls = true;

              return (
                <div key={fixture.fixture_id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-semibold">{fixture.fixture_no}</div>
                      <div className="text-xs text-muted-foreground">
                        {fixture.ingestion_source === "manual_paste" ? "Manual Paste" : "Excel Upload"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <ImageStatusBadge hasImage={!partImageMissing} imageType="Part" />
                      <ImageStatusBadge hasImage={!fixtureImageMissing} imageType="Fixture" />
                    </div>
                  </div>

                  {showImageControls && (
                    <div className="mt-3 space-y-2 rounded-md border border-amber-200/50 bg-amber-50/50 p-3 dark:border-amber-900/30 dark:bg-amber-950/10">
                      {partImageMissing && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm">
                            <div className="font-medium text-amber-900 dark:text-amber-200">Part Image Missing</div>
                            <div className="text-xs text-amber-800/80 dark:text-amber-300">Column F reference image</div>
                          </div>
                          <input
                            ref={fileUploadRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                referenceImageMutation.mutate({ fixtureId: fixture.fixture_id, imageType: "part", file });
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              onSelectImageUpload({ fixtureId: fixture.fixture_id, imageType: "part" });
                              fileUploadRef.current?.click();
                            }}
                            disabled={
                              referenceImageMutation.isPending &&
                              uploadingImageFor?.fixtureId === fixture.fixture_id &&
                              uploadingImageFor?.imageType === "part"
                            }
                          >
                            {referenceImageMutation.isPending &&
                            uploadingImageFor?.fixtureId === fixture.fixture_id &&
                            uploadingImageFor?.imageType === "part" ? (
                              <>
                                <MorphLoader size={14} color="currentColor" />
                              </>
                            ) : (
                              <>
                                <ImageIconSolid className="mr-1 h-4 w-4" />
                                Upload Part Image
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                      {!partImageMissing && fixture.image_1_url && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm">
                            <div className="font-medium text-amber-900 dark:text-amber-200">Part Image Ready</div>
                            <div className="text-xs text-amber-800/80 dark:text-amber-300">Optional support image</div>
                          </div>
                          <div className="flex gap-2">
                            <Button asChild size="sm" variant="outline">
                              <a href={fixture.image_1_url} target="_blank" rel="noreferrer">View Image</a>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                onSelectImageUpload({ fixtureId: fixture.fixture_id, imageType: "part" });
                                fileUploadRef.current?.click();
                              }}
                            >
                              Change
                            </Button>
                          </div>
                        </div>
                      )}

                      {fixtureImageMissing && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm">
                            <div className="font-medium text-amber-900 dark:text-amber-200">Fixture Image Missing</div>
                            <div className="text-xs text-amber-800/80 dark:text-amber-300">Column I reference image</div>
                          </div>
                          <input
                            ref={fileUploadRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                referenceImageMutation.mutate({ fixtureId: fixture.fixture_id, imageType: "fixture", file });
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              onSelectImageUpload({ fixtureId: fixture.fixture_id, imageType: "fixture" });
                              fileUploadRef.current?.click();
                            }}
                            disabled={
                              referenceImageMutation.isPending &&
                              uploadingImageFor?.fixtureId === fixture.fixture_id &&
                              uploadingImageFor?.imageType === "fixture"
                            }
                          >
                            {referenceImageMutation.isPending &&
                            uploadingImageFor?.fixtureId === fixture.fixture_id &&
                            uploadingImageFor?.imageType === "fixture" ? (
                              <>
                                <MorphLoader size={14} color="currentColor" />
                              </>
                            ) : (
                              <>
                                <ImageIconSolid className="mr-1 h-4 w-4" />
                                Upload Fixture Image
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                      {!fixtureImageMissing && fixture.image_2_url && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm">
                            <div className="font-medium text-amber-900 dark:text-amber-200">Fixture Image Ready</div>
                            <div className="text-xs text-amber-800/80 dark:text-amber-300">Optional support image</div>
                          </div>
                          <div className="flex gap-2">
                            <Button asChild size="sm" variant="outline">
                              <a href={fixture.image_2_url} target="_blank" rel="noreferrer">View Image</a>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                onSelectImageUpload({ fixtureId: fixture.fixture_id, imageType: "fixture" });
                                fileUploadRef.current?.click();
                              }}
                            >
                              Change
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {fixture.image_1_url && (
                    <div className="mt-2 rounded-md border bg-muted/30 p-2">
                      <img
                        src={fixture.image_1_url}
                        alt={`${fixture.fixture_no} part`}
                        className="h-20 w-full object-cover rounded"
                      />
                    </div>
                  )}
                  {fixture.image_2_url && (
                    <div className="mt-2 rounded-md border bg-muted/30 p-2">
                      <img
                        src={fixture.image_2_url}
                        alt={`${fixture.fixture_no} fixture`}
                        className="h-20 w-full object-cover rounded"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DialogFooter className="shrink-0 flex-col items-stretch justify-between gap-3 border-t bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
        <p className="text-xs text-muted-foreground">
          Reference images are optional. Assignment can proceed without them.
        </p>
        <Button onClick={onClose} className="bg-primary hover:bg-primary/90">
          <Check className="mr-2 h-4 w-4" />
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

export function DesignExcelUploadModal() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileUploadRef = useRef<HTMLInputElement | null>(null);
  const previewImageInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<"excel" | "paste">("excel");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<DesignExcelUploadResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "incoming" | "existing">>({});
  const [scopeDecisions, setScopeDecisions] = useState<Record<string, "add_fixture" | "skip_fixture">>({});
  const [isDragActive, setIsDragActive] = useState(false);
  const [confirmationStage, setConfirmationStage] = useState<"preview" | "review">("preview");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchFixtures, setBatchFixtures] = useState<BatchFixture[] | null>(null);
  const [uploadingImageFor, setUploadingImageFor] = useState<{ fixtureId: string; imageType: "part" | "fixture" } | null>(null);
  const [previewImageTarget, setPreviewImageTarget] = useState<{ rowKey: string; imageType: "part" | "fixture" } | null>(null);
  const [queuedPreviewImages, setQueuedPreviewImages] = useState<PendingPreviewImageMap>({});

  const clearQueuedPreviewImages = () => {
    setQueuedPreviewImages((current) => {
      Object.values(current).forEach((entry) => {
        entry.part?.previewUrl && URL.revokeObjectURL(entry.part.previewUrl);
        entry.fixture?.previewUrl && URL.revokeObjectURL(entry.fixture.previewUrl);
      });
      return {};
    });
  };

  const resetState = () => {
    clearQueuedPreviewImages();
    setSelectedFile(null);
    setPasteText("");
    setPreview(null);
    setDecisions({});
    setScopeDecisions({});
    setIsDragActive(false);
    setConfirmationStage("preview");
    setBatchId(null);
    setBatchFixtures(null);
    setUploadingImageFor(null);
    setPreviewImageTarget(null);
    setUploadMode("excel");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (fileUploadRef.current) {
      fileUploadRef.current.value = "";
    }
    if (previewImageInputRef.current) {
      previewImageInputRef.current.value = "";
    }
  };

  useEffect(() => () => {
    clearQueuedPreviewImages();
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetState();
    }
  };

  const queuePreviewReferenceImage = (rowKey: string, imageType: "part" | "fixture", file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setQueuedPreviewImages((current) => {
      const existingPreviewUrl = current[rowKey]?.[imageType]?.previewUrl;
      if (existingPreviewUrl) {
        URL.revokeObjectURL(existingPreviewUrl);
      }

      return {
        ...current,
        [rowKey]: {
          ...current[rowKey],
          [imageType]: {
            file,
            previewUrl,
          },
        },
      };
    });
  };

  const uploadQueuedPreviewImages = async (fixtures: BatchFixture[]) => {
    const queuedEntries = Object.entries(queuedPreviewImages);
    if (queuedEntries.length === 0) {
      return fixtures;
    }

    let nextFixtures = [...fixtures];
    let successCount = 0;
    let failureCount = 0;

    for (const [rowKey, images] of queuedEntries) {
      const fixtureNo = rowKey.split("::")[0];
      const batchFixture = nextFixtures.find((fixture) => fixture.fixture_no === fixtureNo);

      if (!batchFixture) {
        failureCount += 1;
        continue;
      }

      for (const imageType of ["part", "fixture"] as const) {
        const queuedImage = images[imageType];
        if (!queuedImage) {
          continue;
        }

        try {
          const data = await uploadFixtureReferenceImage(batchFixture.fixture_id, imageType, queuedImage.file);
          nextFixtures = nextFixtures.map((fixture) => (
            fixture.fixture_id === batchFixture.fixture_id
              ? {
                ...fixture,
                image_1_url: imageType === "part" ? data.new_image_url : fixture.image_1_url,
                image_2_url: imageType === "fixture" ? data.new_image_url : fixture.image_2_url,
              }
              : fixture
          ));
          successCount += 1;
        } catch (error) {
          failureCount += 1;
          console.error("Failed to upload queued preview image", error);
        }
      }
    }

    clearQueuedPreviewImages();

    if (successCount > 0) {
      toast({
        title: "Reference images uploaded",
        description: `${successCount} queued reference image${successCount === 1 ? "" : "s"} saved after fixture confirmation.`,
      });
    }

    if (failureCount > 0) {
      toast({
        title: "Some queued images still need attention",
        description: `${failureCount} image upload${failureCount === 1 ? "" : "s"} could not be completed automatically. You can upload them below.`,
        variant: "default",
      });
    }

    return nextFixtures;
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
    if (!file) return;
    validateClientFile(file);
    setSelectedFile(file);
    setPreview(null);
    setDecisions({});
    setScopeDecisions({});
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDesignExcel(file),
    onSuccess: (data) => {
      setPreview(data);
      const initialDecisions: Record<string, "incoming" | "existing"> = {};
      data.preview.conflicts.forEach((conflict) => {
        initialDecisions[getRowDecisionKey(conflict.incoming)] = "existing";
      });
      setDecisions(initialDecisions);
      setScopeDecisions({});
      setConfirmationStage("preview");
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to process file",
        variant: "destructive",
      });
    },
  });

  const pasteMutation = useMutation({
    mutationFn: (text: string) => pastePasteFixtureData(text),
    onSuccess: (data) => {
      setPreview(data);
      const initialDecisions: Record<string, "incoming" | "existing"> = {};
      data.preview.conflicts.forEach((conflict) => {
        initialDecisions[getRowDecisionKey(conflict.incoming)] = "existing";
      });
      setDecisions(initialDecisions);
      setScopeDecisions({});
      setConfirmationStage("preview");
    },
    onError: (error) => {
      toast({
        title: "Paste failed",
        description: error instanceof Error ? error.message : "Failed to process paste data",
        variant: "destructive",
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (payload: any) => {
      if (uploadMode === "excel") {
        return confirmDesignUpload(payload);
      } else {
        return confirmPasteFixtureData(payload);
      }
    },
    onSuccess: async (data) => {
      setBatchId(data.batch_id);
      setConfirmationStage("review");
      try {
        const fixtures = await listFixturesByUploadBatch(data.batch_id);
        const fixturesWithQueuedImages = await uploadQueuedPreviewImages(fixtures);
        setBatchFixtures(fixturesWithQueuedImages);
      } catch (err) {
        console.error("Failed to load batch fixtures", err);
        toast({
          title: "Warning",
          description: "Batch created but could not load fixture details. Please refresh.",
          variant: "default",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Confirmation failed",
        description: error instanceof Error ? error.message : "Could not complete the process",
        variant: "destructive",
      });
    },
  });

  const referenceImageMutation = useMutation({
    mutationFn: ({ fixtureId, imageType, file }: { fixtureId: string; imageType: "part" | "fixture"; file: File }) =>
      uploadFixtureReferenceImage(fixtureId, imageType, file),
    onSuccess: (data) => {
      toast({
        title: "Image uploaded",
        description: `${data.fixture_no} reference image updated.`,
      });

      setBatchFixtures((prev) => {
        if (!prev) return prev;
        return prev.map((f) => {
          if (f.fixture_id === uploadingImageFor?.fixtureId) {
            if (uploadingImageFor.imageType === "part") {
              return { ...f, image_1_url: data.new_image_url };
            } else {
              return { ...f, image_2_url: data.new_image_url };
            }
          }
          return f;
        });
      });

      setUploadingImageFor(null);
      if (fileUploadRef.current) {
        fileUploadRef.current.value = "";
      }
    },
    onError: (error) => {
      setUploadingImageFor(null);
      toast({
        title: "Image upload failed",
        description: error instanceof Error ? error.message : "Failed to upload image",
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

  const handlePreviewImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && previewImageTarget) {
      queuePreviewReferenceImage(previewImageTarget.rowKey, previewImageTarget.imageType, file);
    }

    setPreviewImageTarget(null);
    if (previewImageInputRef.current) {
      previewImageInputRef.current.value = "";
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
    if (!preview) return;

    const resolved_items: Array<{
      data: DesignExcelPreviewRow;
      resolution: "incoming" | "existing";
      scope_decision?: "add_fixture" | "skip_fixture";
    }> = [];

    preview.preview.accepted.forEach((item) => {
      const scopeDecision = scopeDecisions[getRowDecisionKey(item.incoming)];
      resolved_items.push({
        data: item.incoming,
        resolution: "incoming",
        scope_decision: scopeDecision,
      });
    });

    preview.preview.conflicts.forEach((item) => {
      const decisionKey = getRowDecisionKey(item.incoming);
      const decision = decisions[decisionKey];
      resolved_items.push({
        data: decision === "incoming" ? item.incoming : item.existing,
        resolution: decision === "incoming" ? "incoming" : "existing",
        scope_decision: scopeDecisions[decisionKey],
      });
    });

    confirmMutation.mutate({
      file_info: preview.file_info,
      resolved_items,
      rejected_items: preview.preview.rejected,
      skipped_items: preview.preview.skipped,
    });
  };

  const hasUnresolvedConflicts = preview?.preview.conflicts.some((conflict) => !decisions[getRowDecisionKey(conflict.incoming)]);
  const hasUnresolvedAcceptedScopeDecisions = preview?.preview.accepted.some((item) => (
    item.incoming.scope_status === "AMBIGUOUS"
      && !scopeDecisions[getRowDecisionKey(item.incoming)]
  ));
  const hasUnresolvedIncomingConflictScopeDecisions = preview?.preview.conflicts.some((conflict) => {
    const decisionKey = getRowDecisionKey(conflict.incoming);
    return decisions[decisionKey] === "incoming"
      && conflict.incoming.scope_status === "AMBIGUOUS"
      && !scopeDecisions[decisionKey];
  });
  const hasBlockingScopeDecision = Boolean(
    hasUnresolvedAcceptedScopeDecisions || hasUnresolvedIncomingConflictScopeDecisions,
  );

  const isLoading = uploadMutation.isPending || pasteMutation.isPending || confirmMutation.isPending;

  return (
    <Card className="animate-fade-in mb-6 w-full border-foreground/10 bg-transparent shadow-none">
      <CardHeader className="flex flex-row items-center justify-between rounded-t-xl border-b border-primary/20 bg-gradient-to-r from-primary/10 to-transparent p-4 pb-2">
        <div>
          <h3 className="text-lg font-bold tracking-tight">Design Department Ingestion</h3>
          <p className="text-sm text-muted-foreground">
            Excel upload or manual paste with Python extraction, conflict review, and optional reference images.
          </p>
        </div>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button className="h-10 rounded-full bg-primary px-5 font-semibold shadow-sm transition-all hover:bg-primary/90">
              <UploadCloud className="mr-2 h-4 w-4" />
              Fixture Upload
            </Button>
          </DialogTrigger>
          <DialogContent className="glass flex max-h-[90vh] min-h-0 w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-5xl">
            <input
              ref={previewImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePreviewImageInputChange}
            />
            <DialogHeader className="shrink-0 border-b bg-background/95 p-6 pb-4 pr-12">
              <DialogTitle className="flex items-center gap-2 text-2xl font-bold">
                <FileSpreadsheet className="h-6 w-6 text-primary" />
                Fixture Data Ingestion
              </DialogTitle>
              <DialogDescription>
                Choose upload method: Excel file extraction or manual paste. Review conflicts, confirm selection, and upload reference images.
              </DialogDescription>
            </DialogHeader>

            {confirmationStage === "review" && batchId ? (
              <PostConfirmReviewStage
                batchId={batchId}
                batchFixtures={batchFixtures}
                uploadingImageFor={uploadingImageFor}
                referenceImageMutation={referenceImageMutation}
                fileUploadRef={fileUploadRef}
                onSelectImageUpload={setUploadingImageFor}
                onClose={() => {
                  setOpen(false);
                  resetState();
                  queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
                  queryClient.invalidateQueries({ queryKey: taskQueryKeys.all });
                  queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogs });
                  queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all });
                }}
              />
            ) : !preview ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="fixture-modal-scroll min-h-0 flex-1 overflow-y-auto p-6">
                  <div className="flex flex-col gap-4">
                    {/* Mode Selection */}
                    <div className="rounded-lg border bg-card p-4">
                      <Label className="text-sm font-semibold mb-3 block">Select Upload Method</Label>
                      <RadioGroup value={uploadMode} onValueChange={(val) => setUploadMode(val as "excel" | "paste")}>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="relative rounded-md border p-3 cursor-pointer hover:bg-muted/30">
                            <RadioGroupItem value="excel" id="mode-excel" className="absolute right-3 top-3" />
                            <Label htmlFor="mode-excel" className="cursor-pointer">
                              <div className="text-sm font-medium">Excel File</div>
                              <div className="text-xs text-muted-foreground">Upload .xlsx with Python extraction</div>
                            </Label>
                          </div>
                          <div className="relative rounded-md border p-3 cursor-pointer hover:bg-muted/30">
                            <RadioGroupItem value="paste" id="mode-paste" className="absolute right-3 top-3" />
                            <Label htmlFor="mode-paste" className="cursor-pointer">
                              <div className="text-sm font-medium">Paste Data</div>
                              <div className="text-xs text-muted-foreground">Paste copied rows directly</div>
                            </Label>
                          </div>
                        </div>
                      </RadioGroup>
                    </div>

                    {uploadMode === "excel" ? (
                      <>
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
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setSelectedFile(null);
                                  setPasteText("");
                                  setPreview(null);
                                  setDecisions({});
                                  setScopeDecisions({});
                                }}
                              >
                                Clear
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="rounded-lg border bg-card p-4">
                          <Label className="text-sm font-semibold mb-2 block">Paste Fixture Data</Label>
                          <p className="text-xs text-muted-foreground mb-3">
                            Copy rows from Excel (WBS header line + fixture table with headers). Paste directly below.
                          </p>
                          <textarea
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                            placeholder="Paste your fixture data here...
Example:
WBS-PRJ1-SCOPE_CompanyName
s. no	fixture no	op.no	part name	fixture type	qty	designer
1	FIX001	OP1	Part A	Type1	5	John"
                            className="w-full h-40 p-3 font-mono text-sm border rounded-md bg-muted/20 focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>

                        <div className="rounded-xl border bg-card/60 p-4">
                          <div className="flex items-start gap-3">
                            <div className="rounded-lg bg-primary/10 p-2 text-primary">
                              <FileSpreadsheet className="h-5 w-5" />
                            </div>
                            <div>
                              <div className="font-medium">Paste Format</div>
                              <div className="text-sm text-muted-foreground">
                                {pasteText ? `${pasteText.split('\n').length} lines ready for parsing` : "Include header line and table with headers and data rows."}
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <DialogFooter className="shrink-0 flex-col items-stretch justify-between gap-3 border-t bg-background/95 p-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ImageIcon className="h-4 w-4" />
                    {uploadMode === "excel"
                      ? "Images in columns F (part) and I (fixture) will be extracted and mapped."
                      : "Reference images can be uploaded after confirmation."}
                  </div>
                  <Button
                    onClick={() => {
                      if (uploadMode === "excel" && selectedFile) {
                        uploadMutation.mutate(selectedFile);
                      } else if (uploadMode === "paste" && pasteText) {
                        pasteMutation.mutate(pasteText);
                      }
                    }}
                    disabled={
                      isLoading ||
                      (uploadMode === "excel" && !selectedFile) ||
                      (uploadMode === "paste" && !pasteText.trim())
                    }
                    className="min-w-36 bg-primary hover:bg-primary/90"
                  >
                    {isLoading ? (
                      <>
                        <MorphLoader size={16} color="currentColor" />
                        Processing...
                      </>
                    ) : (
                      "Upload & Preview"
                    )}
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
                              {item.incoming.scope_status === "AMBIGUOUS" ? (
                                <ScopeDecisionControls
                                  row={item.incoming}
                                  value={scopeDecisions[getRowDecisionKey(item.incoming)]}
                                  onChange={(value) => {
                                    setScopeDecisions((current) => ({
                                      ...current,
                                      [getRowDecisionKey(item.incoming)]: value,
                                    }));
                                  }}
                                />
                              ) : null}
                              {uploadMode === "paste" ? (
                                <PreviewReferenceImageControls
                                  row={item.incoming}
                                  rowKey={getRowDecisionKey(item.incoming)}
                                  queuedImages={queuedPreviewImages}
                                  onSelect={(rowKey, imageType) => {
                                    setPreviewImageTarget({ rowKey, imageType });
                                    previewImageInputRef.current?.click();
                                  }}
                                />
                              ) : null}
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
                                value={decisions[getRowDecisionKey(conflict.incoming)]}
                                onValueChange={(value: "incoming" | "existing") => {
                                  setDecisions((current) => ({
                                    ...current,
                                    [getRowDecisionKey(conflict.incoming)]: value,
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
                                    {uploadMode === "paste" ? (
                                      <PreviewReferenceImageControls
                                        row={conflict.incoming}
                                        rowKey={getRowDecisionKey(conflict.incoming)}
                                        queuedImages={queuedPreviewImages}
                                        onSelect={(rowKey, imageType) => {
                                          setPreviewImageTarget({ rowKey, imageType });
                                          previewImageInputRef.current?.click();
                                        }}
                                      />
                                    ) : null}
                                    <ImagePreviewStrip row={conflict.incoming} />
                                  </Label>
                                </div>
                              </RadioGroup>
                              {decisions[getRowDecisionKey(conflict.incoming)] === "incoming" && conflict.incoming.scope_status === "AMBIGUOUS" ? (
                                <ScopeDecisionControls
                                  row={conflict.incoming}
                                  value={scopeDecisions[getRowDecisionKey(conflict.incoming)]}
                                  onChange={(value) => {
                                    setScopeDecisions((current) => ({
                                      ...current,
                                      [getRowDecisionKey(conflict.incoming)]: value,
                                    }));
                                  }}
                                />
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {preview.preview.skipped.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="flex items-center gap-2 border-b pb-2 font-semibold text-slate-700 dark:text-slate-200">
                          <XCircle className="h-5 w-5" />
                          Skipped Customer Scope ({preview.preview.skipped.length})
                        </h5>
                        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                          {preview.preview.skipped.map((item, index) => (
                            <div key={`${item.fixture_no}-${index}`} className="rounded-lg border bg-slate-50/80 p-3 text-sm dark:bg-slate-950/20">
                              <div className="font-medium">{item.fixture_no}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Row {item.row_number} • {item.part_name}
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">
                                Type: <span className="font-medium text-foreground">{item.fixture_type}</span> • OP: <span className="font-medium text-foreground">{item.op_no}</span> • Qty: <span className="font-medium text-foreground">{item.qty}</span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Remark: <span className="font-medium text-foreground">{formatRemark(item.remark)}</span>
                              </div>
                              <div className="mt-2 rounded-md border border-slate-200 bg-background/70 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:text-slate-300">
                                {item.skip_reason}
                              </div>
                              <ImagePreviewStrip row={item} />
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
                            <div key={`${rejected.row_number}-${index}`} className="rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/20">
                              <div className="flex justify-between gap-3">
                                <span className="w-20 font-bold text-red-700 dark:text-red-400">
                                  {rejected.row_number > 0 ? `Row ${rejected.row_number}` : "General"}
                                </span>
                                <span className="flex-1 text-red-600 dark:text-red-300">{rejected.error_message}</span>
                              </div>
                              {rejected.raw_data?.validation ? (
                                <div className="mt-3 rounded-md border border-red-200/70 bg-background/70 p-3 text-xs text-muted-foreground dark:border-red-900/40">
                                  {rejected.raw_data.validation.sheet_name ? (
                                    <div>
                                      Sheet: <span className="font-medium text-foreground">{rejected.raw_data.validation.sheet_name}</span>
                                    </div>
                                  ) : null}
                                  <div>
                                    Raw: Fixture No <span className="font-medium text-foreground">{formatRejectedValue(rejected.raw_data.validation.raw?.fixture_no)}</span>,
                                    {" "}OP.NO <span className="font-medium text-foreground">{formatRejectedValue(rejected.raw_data.validation.raw?.op_no)}</span>,
                                    {" "}Fixture Type <span className="font-medium text-foreground">{formatRejectedValue(rejected.raw_data.validation.raw?.fixture_type)}</span>,
                                    {" "}QTY <span className="font-medium text-foreground">{formatRejectedValue(rejected.raw_data.validation.raw?.qty)}</span>
                                  </div>
                                  <div>
                                    Normalized: Fixture No <span className="font-medium text-foreground">{formatRejectedValue(rejected.raw_data.validation.normalized?.fixture_no)}</span>,
                                    {" "}OP.NO <span className="font-medium text-foreground">{formatRejectedValue(rejected.raw_data.validation.normalized?.op_no)}</span>,
                                    {" "}Fixture Type <span className="font-medium text-foreground">{formatRejectedValue(rejected.raw_data.validation.normalized?.fixture_type)}</span>,
                                    {" "}QTY <span className="font-medium text-foreground">{formatRejectedValue(rejected.raw_data.validation.normalized?.qty)}</span>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <DialogFooter className="shrink-0 flex-col items-stretch justify-between gap-3 border-t bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPreview(null);
                      setSelectedFile(null);
                      setPasteText("");
                      setDecisions({});
                      setScopeDecisions({});
                    }}
                  >
                    Cancel & Reload
                  </Button>
                  {hasBlockingScopeDecision ? (
                    <div className="text-xs text-amber-700 dark:text-amber-300">
                      Choose Add Fixture or Skip Fixture for every ambiguous-scope row before saving.
                    </div>
                  ) : null}
                  <Button
                    onClick={handleConfirm}
                    disabled={confirmMutation.isPending || hasUnresolvedConflicts || hasBlockingScopeDecision}
                    className="min-w-36 bg-primary hover:bg-primary/90"
                  >
                    {confirmMutation.isPending ? (
                      <>
                        <MorphLoader size={16} color="currentColor" />
                        Saving...
                      </>
                    ) : (
                      "Confirm & Save"
                    )}
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
