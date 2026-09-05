import { useCallback, useEffect, useRef, useState } from "react";
import { chooseImageFiles, importImageFiles, onCaptureError, onImageImportCompleted, pasteImageFromClipboard } from "../lib/api";
import type { ImageImportInput, ImageImportResult, SectionFilter } from "../types";
import type { ToastTone } from "./use-notify";

export function imageImportSummary(result: ImageImportResult): string {
  const captured = `${result.items.length} image${result.items.length === 1 ? "" : "s"} captured`;
  return result.issues.length ? `${captured} · ${result.issues.length} could not be added` : captured;
}

export function useImageImport({ sectionFilter, notify, onSuccess }: { sectionFilter: SectionFilter; notify: (message: string, tone?: ToastTone) => void; onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImageImportResult | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const acceptResult = useCallback((next: ImageImportResult) => {
    if (next.cancelled) return;
    setResult(next);
    if (next.items.length) onSuccess();
    if (!next.issues.length && !next.warnings.length) notify(imageImportSummary(next));
  }, [notify, onSuccess]);

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    void Promise.all([
      onImageImportCompleted((next) => { if (!disposed) acceptResult(next); }).then(retain),
      onCaptureError((message) => { if (!disposed) notify(message, "error"); }).then(retain),
    ]).catch((error) => { if (!disposed) notify(String(error), "error"); });
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [acceptResult, notify]);

  const run = useCallback(async (operation: (input: ImageImportInput) => Promise<ImageImportResult>) => {
    if (running.current) { notify("An image import is already running."); return; }
    const input = { requestId: crypto.randomUUID(), sectionId: sectionFilter === "all" || sectionFilter === "unfiled" ? null : sectionFilter };
    running.current = true;
    setBusy(true);
    try {
      const next = await operation(input);
      if (!mounted.current || next.cancelled) return;
      if (next.requestId !== input.requestId) throw new Error("Could not verify the image import result.");
      // Native mutation events own the queue. Replaying the response here could
      // resurrect an image deleted after commit but before this reply arrived.
      acceptResult(next);
    } catch (error) {
      if (mounted.current) setResult({ requestId: input.requestId, cancelled: false, items: [], warnings: [], issues: [{ index: null, name: null, code: "import_failed", message: error instanceof Error ? error.message : String(error) }] });
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [acceptResult, notify, sectionFilter]);

  const chooseImages = useCallback(() => run(chooseImageFiles), [run]);
  const pasteImage = useCallback(() => run(pasteImageFromClipboard), [run]);
  const importPaths = useCallback((paths: string[]) => run((input) => importImageFiles({ ...input, paths })), [run]);
  return { busy, result, chooseImages, pasteImage, importPaths, dismissResult: () => setResult(null) };
}
