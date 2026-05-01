import { useRef, useState, type ChangeEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Image as ImageIcon, UploadCloud } from "lucide-react";
import { uploadFixtureReferenceImage } from "@/api/designApi";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { DesignFixtureOption } from "@/types";

type ImageType = "part" | "fixture";

interface FixtureReferenceImageSupportProps {
  fixture: Pick<DesignFixtureOption, "fixture_id" | "fixture_no" | "image_1_url" | "image_2_url">;
  departmentId?: string;
  onFixtureImagesChange?: (next: { image_1_url: string | null; image_2_url: string | null }) => void;
}

function ReferenceImageCard({
  label,
  imageUrl,
  isUploading,
  onUpload,
}: {
  label: string;
  imageUrl: string | null | undefined;
  isUploading: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="rounded-xl border bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 text-sm font-medium">{imageUrl ? "Reference image available" : "Reference image missing"}</div>
        </div>
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
      </div>

      {imageUrl ? (
        <div className="mt-3 space-y-3">
          <img src={imageUrl} alt={label} className="h-28 w-full rounded-lg border object-cover" />
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={imageUrl} target="_blank" rel="noreferrer">View Image</a>
            </Button>
            <Button size="sm" variant="outline" onClick={onUpload} disabled={isUploading}>
              Change
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="mt-3" onClick={onUpload} disabled={isUploading}>
          <UploadCloud className="mr-2 h-4 w-4" />
          {label === "Part Image" ? "Upload Part Image" : "Upload Fixture Image"}
        </Button>
      )}
    </div>
  );
}

export function FixtureReferenceImageSupport({
  fixture,
  departmentId,
  onFixtureImagesChange,
}: FixtureReferenceImageSupportProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingTarget, setPendingTarget] = useState<ImageType | null>(null);

  const uploadMutation = useMutation({
    mutationFn: ({ imageType, file }: { imageType: ImageType; file: File }) => (
      uploadFixtureReferenceImage(fixture.fixture_id, imageType, file, departmentId)
    ),
    onSuccess: (data) => {
      const nextImages = pendingTarget === "part"
        ? { image_1_url: data.new_image_url, image_2_url: fixture.image_2_url ?? null }
        : { image_1_url: fixture.image_1_url ?? null, image_2_url: data.new_image_url };

      onFixtureImagesChange?.(nextImages);
      toast({
        title: "Reference image updated",
        description: `${data.fixture_no} image saved.`,
      });
      setPendingTarget(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    onError: (error) => {
      toast({
        title: "Reference image upload failed",
        description: error instanceof Error ? error.message : "Could not upload the image",
        variant: "destructive",
      });
      setPendingTarget(null);
    },
  });

  const openFilePicker = (imageType: ImageType) => {
    setPendingTarget(imageType);
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !pendingTarget) {
      return;
    }

    uploadMutation.mutate({ imageType: pendingTarget, file });
  };

  return (
    <div className="space-y-3 rounded-xl border border-amber-200/60 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/10">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
          Reference Images
        </div>
        <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
          Optional support images only. This does not affect proof-image submission.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ReferenceImageCard
          label="Part Image"
          imageUrl={fixture.image_1_url}
          isUploading={uploadMutation.isPending && pendingTarget === "part"}
          onUpload={() => openFilePicker("part")}
        />
        <ReferenceImageCard
          label="Fixture Image"
          imageUrl={fixture.image_2_url}
          isUploading={uploadMutation.isPending && pendingTarget === "fixture"}
          onUpload={() => openFilePicker("fixture")}
        />
      </div>
    </div>
  );
}
