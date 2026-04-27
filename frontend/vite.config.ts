import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const runtimeEnv = loadEnv(mode, __dirname, "");
  const nextPublicApiUrl = runtimeEnv.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "";

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    define: {
      "process.env.NEXT_PUBLIC_API_URL": JSON.stringify(nextPublicApiUrl),
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon-192v2.png", "icon-512v2.png"],
        manifest: {
          name: "Task Tracker",
          short_name: "Tasks",
          start_url: "/",
          theme_color: "#000000",
          background_color: "#ffffff",
          display: "standalone",
          icons: [
            {
              src: "/icon-192v2.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/icon-512v2.png",
              sizes: "512x512",
              type: "image/png",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
          runtimeCaching: [
            {
              urlPattern: /\/api\/.*/i,
              handler: "NetworkFirst",
              options: {
                cacheName: "api-cache",
                networkTimeoutSeconds: 5,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            query: ["@tanstack/react-query"],
            ui: [
              "@/components/ui/button",
              "@/components/ui/card",
              "@/components/ui/input",
              "@/components/ui/select",
              "@/components/ui/table",
              "@/components/ui/dropdown-menu",
              "@/components/ui/sidebar",
              "@/components/ui/avatar",
              "@/components/ui/separator",
            ],
          },
        },
      },
    },
  };
});
