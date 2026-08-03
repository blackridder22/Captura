import { useEffect, useState } from "react";
import { importImageFiles, isTauriRuntime } from "../lib/api";
import type { ToastTone } from "./use-notify";

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|tiff?|heic|bmp)$/i;

type FileDropDeps = {
  notify: (text: string, tone?: ToastTone) => void;
};

/// Native file drop onto the panel (Tauri's drag-drop events, since HTML5
/// drag events are suppressed when the native handler is enabled).
export function useFileDrop({ notify }: FileDropDeps) {
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let stop: (() => void) | undefined;

    void (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const off = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "enter") {
          setDropping(event.payload.paths.some((path) => IMAGE_FILE.test(path)));
        } else if (event.payload.type === "leave") {
          setDropping(false);
        } else if (event.payload.type === "drop") {
          setDropping(false);
          const images = event.payload.paths.filter((path) =>
            IMAGE_FILE.test(path),
          );
          if (!images.length) return;
          void importImageFiles(images)
            .then((items) => {
              notify(
                `${items.length} image${items.length === 1 ? "" : "s"} captured`,
              );
            })
            .catch((error) => {
              notify(
                typeof error === "string"
                  ? error
                  : "Could not import the dropped images.",
                "error",
              );
            });
        }
      });
      if (disposed) {
        off();
      } else {
        stop = off;
      }
    })();

    return () => {
      disposed = true;
      stop?.();
    };
  }, [notify]);

  return { dropping };
}
