/// <reference lib="webworker" />

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";

/**
 * Workbox injectManifest will replace `self.__WB_MANIFEST` at build time.
 * We keep caching behavior close to the existing precache-based setup,
 * then explicitly control lifecycle for updates.
 */
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Ensure SW takes control immediately after activation (critical for installed desktop PWAs).
clientsClaim();

// --- Update lifecycle controls (required) ---

// Some clients/devices won't call skipWaiting unless explicitly triggered.
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === "SKIP_WAITING") {
    // Move immediately to activating.
    self.skipWaiting();
  }
});

// If you want to be extra safe, you can also claim on activation.
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Take control right away; avoids stale-controller issues on desktop installs.
    await clientsClaim();
  })());
});

// --- Runtime caching (keep it conservative to avoid stale HTML issues) ---

// Always serve the application shell (index.html) from network-first,
// but fall back to cache if offline.
registerRoute(
  ({ request, url }) => request.mode === "navigate" && url.origin === self.location.origin,
  new NetworkFirst({
    cacheName: "app-shell",
    networkTimeoutSeconds: 5,
  })
);

// For static assets, stale-while-revalidate is fine.
registerRoute(
  ({ request }) => request.destination === "script" || request.destination === "style" || request.destination === "image",
  new StaleWhileRevalidate({
    cacheName: "static-assets",
    plugins: [],
  })
);
