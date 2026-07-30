import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CaptureHud } from "./components/capture-hud";
import { isTauriRuntime } from "./lib/api";
import "./styles/globals.css";

if (isTauriRuntime()) {
  document.documentElement.dataset.runtime = "tauri";
}

const hudMode =
  new URLSearchParams(window.location.search).get("hud") === "1" ||
  window.location.hash === "#hud";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{hudMode ? <CaptureHud /> : <App />}</StrictMode>,
);

