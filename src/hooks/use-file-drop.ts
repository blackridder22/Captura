import { useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../lib/api";
import type { ToastTone } from "./use-notify";

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|tiff?|heic|bmp)$/i;
type FileDropDeps = {
  importPaths: (paths: string[]) => Promise<void>;
  notify: (text: string, tone?: ToastTone) => void;
  busy: boolean;
};

/** Preserve Wry's whole-panel file drops; Rust validates the actual file data. */
export function useFileDrop({ importPaths, notify, busy }: FileDropDeps) {
  const [dropping, setDropping] = useState(false);
  const latest = useRef({ importPaths, notify, busy });
  latest.current = { importPaths, notify, busy };
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      if (disposed) return;
      const off = await getCurrentWebview().onDragDropEvent((event) => {
        if (disposed) return;
        if (event.payload.type === "enter") {
          setDropping(!latest.current.busy && event.payload.paths.some((path) => IMAGE_FILE.test(path)));
        } else if (event.payload.type === "leave") {
          setDropping(false);
        } else if (event.payload.type === "drop") {
          setDropping(false);
          if (!event.payload.paths.length) return;
          // Pass every supplied file so unsupported members get an individual
          // error rather than disappearing from mixed image batches.
          void latest.current.importPaths(event.payload.paths);
        }
      });
      if (disposed) off(); else stop = off;
    })().catch((error) => { if (!disposed) latest.current.notify(String(error), "error"); });
    return () => { disposed = true; stop?.(); };
  }, []);
  return { dropping };
}
