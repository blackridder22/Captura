import { useCallback, useRef, useState } from "react";

export type ToastTone = "info" | "error";

export function useNotify() {
  const [announcement, setAnnouncement] = useState("");
  const [toast, setToast] = useState<{
    text: string;
    tone: ToastTone;
  } | null>(null);
  // TODO(phase2): the timer is never cleared on unmount. App never unmounts
  // in production; fixing it is a behavior change outside this refactor.
  const toastTimerRef = useRef<number | null>(null);

  const announce = useCallback((text: string) => {
    setAnnouncement(text);
  }, []);

  const notify = useCallback((text: string, tone: ToastTone = "info") => {
    setAnnouncement(text);
    setToast({ text, tone });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(
      () => setToast(null),
      tone === "error" ? 4200 : 2200,
    );
  }, []);

  return { announcement, toast, announce, notify };
}
