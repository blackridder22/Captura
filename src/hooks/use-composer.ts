import { useCallback, useEffect, useRef, useState } from "react";
import { inferKind } from "../lib/items";
import type { ItemKind } from "../types";

export function useComposer() {
  const [composer, setComposer] = useState("");
  const [composerKind, setComposerKind] = useState<ItemKind>("prompt");
  const [saving, setSaving] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!composer.trim()) return;
    setComposerKind(inferKind(composer));
  }, [composer]);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  return {
    composer,
    setComposer,
    composerKind,
    setComposerKind,
    saving,
    setSaving,
    composerRef,
    focusComposer,
  };
}
