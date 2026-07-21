import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const runtimeEnv = loadEnv(mode, __dirname, "");
  const viteApiUrl = runtimeEnv.VITE_API_URL || process.env.VITE_API_URL || "";
  const vitePythonServiceUrl = runtimeEnv.VITE_PYTHON_SERVICE_URL || process.env.VITE_PYTHON_SERVICE_URL || "";

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    define: {
      "process.env.VITE_API_URL": JSON.stringify(viteApiUrl),
      "process.env.VITE_PYTHON_SERVICE_URL": JSON.stringify(vitePythonServiceUrl),
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      VitePWA({
        srcDir: "src",
        filename: "sw.js",
        registerType: "prompt",
        includeAssets: ["icon-192.png", "icon-512.png"],
        manifest: false,
        strategies: "injectManifest",
        injectManifest: {
          swSrc: "src/sw.js",
        },
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
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
