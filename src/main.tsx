import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { isTauriRuntime } from "./lib/api";
import "./styles/globals.css";

const App = lazy(() => import("./App"));
const CaptureHud = lazy(() => import("./components/capture-hud").then((module) => ({ default: module.CaptureHud })));

if (isTauriRuntime()) {
  document.documentElement.dataset.runtime = "tauri";
}

const hudMode =
  new URLSearchParams(window.location.search).get("hud") === "1" ||
  window.location.hash === "#hud";

createRoot(document.getElementById("root")!).render(
  <StrictMode><Suspense fallback={null}>{hudMode ? <CaptureHud /> : <App />}</Suspense></StrictMode>,
);
