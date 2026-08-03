import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { onHudCapture } from "../lib/api";
import type { CaptureItem } from "../types";
import { BrandMark } from "./brand-mark";

const previewItem: CaptureItem = {
  id: "hud-preview",
  kind: "prompt",
  content: "Compare Tauri accessibility APIs with the clipboard fallback",
  status: "open",
  sourceApp: "ChatGPT",
  sourceBundleId: "com.openai.chat",
  sectionId: null,
  attachmentPath: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function CaptureHud() {
  const [item, setItem] = useState<CaptureItem>(previewItem);

  useEffect(() => {
    let unlisten: () => void = () => {};
    void onHudCapture(setItem).then((off) => {
      unlisten = off;
    });
    return () => unlisten();
  }, []);

  return (
    <main className="hud-frame">
      <section className="capture-hud" aria-live="polite">
        <span className="hud-check">
          <Check size={18} strokeWidth={2.3} />
        </span>
        <div>
          <strong>Captured</strong>
          <p>{item.content}</p>
        </div>
        <BrandMark className="hud-mark" />
      </section>
    </main>
  );
}
