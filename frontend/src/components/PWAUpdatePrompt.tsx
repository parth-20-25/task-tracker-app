import { useMemo, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, Wifi, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PWAUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [isUpdating, setIsUpdating] = useState(false);

  const prompt = useMemo(() => {
    if (needRefresh) {
      return {
        title: "A new version is available",
        description: "Update now to load the latest improvements without reinstalling the app.",
        icon: RefreshCw,
      };
    }

    if (offlineReady) {
      return {
        title: "App ready offline",
        description: "This app is cached and can keep working when your connection drops.",
        icon: Wifi,
      };
    }

    return null;
  }, [needRefresh, offlineReady]);

  const closePrompt = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
    setIsUpdating(false);
  };

  const handleUpdate = async () => {
    setIsUpdating(true);

    try {
      await updateServiceWorker(true);
    } catch (error) {
      console.error("PWA update failed", error);
      window.location.reload();
    }
  };

  if (!prompt) {
    return null;
  }

  const PromptIcon = prompt.icon;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex justify-center sm:justify-end">
      <Card className="pointer-events-auto w-full max-w-md border-primary/20 bg-background/95 shadow-xl backdrop-blur">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
            <PromptIcon className={cn("h-4 w-4", isUpdating && "animate-spin")} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{prompt.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{prompt.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {needRefresh ? (
                <>
                  <Button onClick={handleUpdate} disabled={isUpdating} size="sm">
                    {isUpdating ? "Updating..." : "Update Now"}
                  </Button>
                  <Button onClick={closePrompt} disabled={isUpdating} size="sm" variant="outline">
                    Later
                  </Button>
                </>
              ) : (
                <Button onClick={closePrompt} size="sm" variant="outline">
                  Close
                </Button>
              )}
            </div>
          </div>
          <Button
            aria-label="Dismiss update prompt"
            className="h-8 w-8 shrink-0"
            onClick={closePrompt}
            size="icon"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
