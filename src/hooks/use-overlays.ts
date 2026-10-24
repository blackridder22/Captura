import { useCallback, useRef, useState } from "react";
import { hideMainWindow } from "../lib/api";
import type { ContextMenu } from "../types";

/// Escape peels one layer at a time: menu, then settings, then a
/// multi-selection, and only then the panel itself. Settings is a full page
/// over the queue, so opening it remembers the control that opened it and
/// closing hands focus back there.
export function useOverlays({ hasMultiSelection, clearSelection }: { hasMultiSelection: boolean; clearSelection: () => void }) {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpener = useRef<HTMLElement | null>(null);

  const openSettings = useCallback(() => {
    settingsOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    const opener = settingsOpener.current;
    settingsOpener.current = null;
    if (opener?.isConnected) {
      // The queue is inert until the close renders; focus after that frame.
      requestAnimationFrame(() => opener.focus({ preventScroll: true }));
    }
  }, []);

  const dismissTop = useCallback(() => {
    if (contextMenu) {
      setContextMenu(null);
    } else if (settingsOpen) {
      closeSettings();
    } else if (hasMultiSelection) {
      clearSelection();
    } else {
      void hideMainWindow();
    }
  }, [clearSelection, closeSettings, contextMenu, hasMultiSelection, settingsOpen]);

  return {
    contextMenu,
    setContextMenu,
    settingsOpen,
    openSettings,
    closeSettings,
    dismissTop,
  };
}
