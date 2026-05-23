import { useMemo, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { isKnownBrokenImageUrl, markBrokenImageUrl, resolveImageUrl } from "@/lib/imageUrl";
import { cn } from "@/lib/utils";

interface SafeImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  placeholderClassName?: string;
}

export function SafeImage({ src, alt, className, placeholderClassName }: SafeImageProps) {
  const resolvedSrc = useMemo(() => resolveImageUrl(src), [src]);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const isMissing = !resolvedSrc || failedSrc === resolvedSrc || isKnownBrokenImageUrl(resolvedSrc);

  if (isMissing) {
    return (
      <div className={cn("flex items-center justify-center rounded-md border border-dashed bg-slate-50 text-slate-400", placeholderClassName || className)}>
        <ImageIcon className="h-5 w-5" aria-hidden="true" />
        <span className="sr-only">{alt} unavailable</span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={() => {
        markBrokenImageUrl(resolvedSrc);
        setFailedSrc(resolvedSrc);
      }}
    />
  );
}
