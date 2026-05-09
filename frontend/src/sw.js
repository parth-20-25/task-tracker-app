/// <reference lib="webworker" />
// NOTE: This project’s vite-plugin-pwa@1.2.0 expects an entry module at src/sw.js
// for injectManifest. Keep this file in sync with sw.ts.

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";

const selfAny = self;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

clientsClaim();

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await clientsClaim();
    })(),
  );
});

registerRoute(
  ({ request, url }) => request.mode === "navigate" && url.origin === self.location.origin,
  new NetworkFirst({
    cacheName: "app-shell",
    networkTimeoutSeconds: 5,
  }),
);

registerRoute(
  ({ request }) =>
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "image",
  new StaleWhileRevalidate({
    cacheName: "static-assets",
    plugins: [],
  }),
);
