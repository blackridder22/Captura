import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { isTauriRuntime } from "./lib/api";
import "./styles/globals.css";

const App = lazy(() => import("./App"));
const CaptureHud = lazy(() => import("./components/capture-hud").then((module) => ({ default: module.CaptureHud })));
const CaptureDetail = lazy(() => import("./components/capture-detail"));

if (isTauriRuntime()) {
  document.documentElement.dataset.runtime = "tauri";
}

const hudMode =
  new URLSearchParams(window.location.search).get("hud") === "1" ||
  window.location.hash === "#hud";
const detailMode = new URLSearchParams(window.location.search).get("detail") === "1";
if (detailMode) document.documentElement.dataset.window = "detail";

createRoot(document.getElementById("root")!).render(
  <StrictMode><Suspense fallback={null}>{detailMode ? <CaptureDetail /> : hudMode ? <CaptureHud /> : <App />}</Suspense></StrictMode>,
);
