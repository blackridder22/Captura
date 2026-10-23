import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "info" | "error";
export type ToastAction = { label: string; run: () => void | Promise<void> };
export type Toast = { text: string; tone: ToastTone; action?: ToastAction };

export function useNotify() {
  const [announcement, setAnnouncement] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const announce = useCallback((text: string) => {
    setAnnouncement(text);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast(null);
  }, []);

  const notify = useCallback((text: string, tone: ToastTone = "info", action?: ToastAction) => {
    setAnnouncement(text);
    setToast({ text, tone, action });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    // An actionable toast (Undo) stays long enough to be read and clicked.
    const duration = action ? 5200 : tone === "error" ? 4200 : 2200;
    toastTimerRef.current = window.setTimeout(() => setToast(null), duration);
  }, []);

  return { announcement, toast, announce, notify, dismissToast };
}
