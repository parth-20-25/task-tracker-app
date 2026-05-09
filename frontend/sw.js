/// <reference lib="webworker" />
// NOTE: This project’s vite-plugin-pwa@1.2.0 expects an entry module at frontend/sw.js
// for injectManifest. Keep this file in sync with src/sw.js.

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";

precacheAndRoute([{"revision":"79ad3ae43cef23294967576cdc621397","url":"sw.js"},{"revision":"0997461c7d595fc7027c5772f6155faa","url":"index.html"},{"revision":null,"url":"assets/WorkflowsTab-BBgD3B0t.js"},{"revision":null,"url":"assets/workbox-window.prod.es5-vqzQaGvo.js"},{"revision":null,"url":"assets/Verifications-6whSxvvP.js"},{"revision":null,"url":"assets/UsersTab-DRgcSA15.js"},{"revision":null,"url":"assets/ui-D_eAOdvG.js"},{"revision":null,"url":"assets/textarea-DXeo76cp.js"},{"revision":null,"url":"assets/TeamTasks-CS8vGlUX.js"},{"revision":null,"url":"assets/taskDisplay-BTwns3lG.js"},{"revision":null,"url":"assets/TaskCard-CmZdUt1J.js"},{"revision":null,"url":"assets/TaskAssignmentBar-B5gD8-6V.js"},{"revision":null,"url":"assets/tabs-BPIIHvUy.js"},{"revision":null,"url":"assets/ShiftsTab-YxMN_e2l.js"},{"revision":null,"url":"assets/RolesTab-CHK2Pdft.js"},{"revision":null,"url":"assets/Reports-hAcn3Vln.js"},{"revision":null,"url":"assets/react-CUrfWpUZ.js"},{"revision":null,"url":"assets/query-BvZOCd3g.js"},{"revision":null,"url":"assets/Notifications-ZkyVkgYh.js"},{"revision":null,"url":"assets/NotFound-DdxvXniF.js"},{"revision":null,"url":"assets/MyTasks-DKrAQam_.js"},{"revision":null,"url":"assets/MachinesTab-91Qqdisx.js"},{"revision":null,"url":"assets/Issues-DeVwG_76.js"},{"revision":null,"url":"assets/index-LtG_lYAl.css"},{"revision":null,"url":"assets/index-Db-e8eko.js"},{"revision":null,"url":"assets/dialog-BSSzNqdO.js"},{"revision":null,"url":"assets/designApi-BJVegKkw.js"},{"revision":null,"url":"assets/DepartmentsTab-CIvHy5u8.js"},{"revision":null,"url":"assets/Dashboard-Wx9dAoMr.css"},{"revision":null,"url":"assets/Dashboard-CsBxqO-v.js"},{"revision":null,"url":"assets/checkbox-B258NmYk.js"},{"revision":null,"url":"assets/Batches-DBIRjnGg.js"},{"revision":null,"url":"assets/badge-jec3t0Sf.js"},{"revision":null,"url":"assets/AuditTab-BHU1gXnh.js"},{"revision":null,"url":"assets/AnalyticsDashboard-C5s37TUC.js"},{"revision":null,"url":"assets/AdminPanel-DONcrNTG.js"},{"revision":null,"url":"assets/adminApi-BM5_Usxu.js"},{"revision":"d22bbc0727b40f237c9e3e685cd8e716","url":"icon-192.png"},{"revision":"98411c052754c0e96edd59487cbea6a2","url":"icon-512.png"},{"revision":"e5ff311ad6461f642428c6b5fd7d6f5d","url":"manifest.webmanifest"}]);
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
