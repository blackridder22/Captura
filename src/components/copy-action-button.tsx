import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ItemKind } from "../types";
import { Button } from "./ui/button";

type CopyPhase = "idle" | "copying" | "copied";

type CopyActionButtonProps = {
  kind: ItemKind;
  onCopy: () => Promise<void>;
};

export function CopyActionButton({ kind, onCopy }: CopyActionButtonProps) {
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const resetTimer = useRef<number | null>(null);
  const copyLabel = kind === "image" ? "Copy image" : "Copy as Markdown";

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleCopy = async () => {
    if (phase === "copying") return;
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    setPhase("copying");
    try {
      await onCopy();
      setPhase("copied");
      resetTimer.current = window.setTimeout(() => setPhase("idle"), 1200);
    } catch {
      setPhase("idle");
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={phase === "copied" ? `${copyLabel} complete` : copyLabel}
      onClick={() => void handleCopy()}
    >
      <span className="copy-feedback" data-phase={phase} aria-hidden="true">
        <Copy className="copy-feedback-copy" size={13} />
        <Check className="copy-feedback-check" size={13} strokeWidth={2.5} />
      </span>
      <span className="sr-only" aria-live="polite">
        {phase === "copied" ? (kind === "image" ? "Image copied" : "Markdown copied") : ""}
      </span>
    </Button>
  );
}
