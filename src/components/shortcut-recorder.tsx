import { useEffect, useRef, useState } from "react";
import type { ShortcutAction } from "../types";
import {
  hasModifier,
  shortcutFromEvent,
  shortcutLabel,
} from "../lib/shortcuts";

type ShortcutRecorderProps = {
  action: ShortcutAction;
  value: string;
  onChange: (shortcut: string) => Promise<void>;
};

export function ShortcutRecorder({
  action,
  value,
  onChange,
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);

  // WKWebView does not focus a <button> on click, so key events never reach
  // element-level listeners while recording. Capture them at the window level
  // instead, and swallow everything so app shortcuts cannot fire mid-record.
  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(false);
        return;
      }

      const shortcut = shortcutFromEvent(event);
      if (!shortcut) return;
      if (action === "capture" && !hasModifier(shortcut)) {
        setError("Global capture needs a modifier key.");
        return;
      }

      setRecording(false);
      setSaving(true);
      setError("");
      void onChange(shortcut)
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => setSaving(false));
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) {
        setRecording(false);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [recording, action, onChange]);

  return (
    <span className="shortcut-recorder-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="shortcut-recorder"
        data-recording={recording}
        data-error={Boolean(error)}
        aria-label={`Change ${action} shortcut`}
        aria-pressed={recording}
        title={error || "Click, then press the shortcut you want"}
        onClick={() => {
          setError("");
          setRecording((current) => !current);
        }}
      >
        {saving ? "Saving…" : recording ? "Press keys…" : shortcutLabel(value)}
      </button>
      {error ? <small role="alert">{error}</small> : null}
    </span>
  );
}
