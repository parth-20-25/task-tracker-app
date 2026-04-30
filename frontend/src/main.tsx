import { createRoot } from "react-dom/client";
import { API_BASE_URL } from "@/api/config";
import App from "./App.tsx";
import "./index.css";

const warmBackend = () => {
  void fetch(`${API_BASE_URL}/health`, {
    method: "GET",
    cache: "no-store",
  }).catch(() => undefined);
};

if (typeof window !== "undefined") {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(warmBackend, { timeout: 3000 });
  } else {
    window.setTimeout(warmBackend, 0);
  }
}


createRoot(document.getElementById("root")!).render(<App />);
