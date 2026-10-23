import { useCallback, useState } from "react";
import { hideMainWindow } from "../lib/api";
import type { ContextMenu } from "../types";

/// Escape peels one layer at a time: menu, then settings, then a
/// multi-selection, and only then the panel itself.
export function useOverlays({ hasMultiSelection, clearSelection }: { hasMultiSelection: boolean; clearSelection: () => void }) {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  const dismissTop = useCallback(() => {
    if (contextMenu) {
      setContextMenu(null);
    } else if (settingsOpen) {
      setSettingsOpen(false);
    } else if (hasMultiSelection) {
      clearSelection();
    } else {
      void hideMainWindow();
    }
  }, [clearSelection, contextMenu, hasMultiSelection, settingsOpen]);

  return {
    contextMenu,
    setContextMenu,
    settingsOpen,
    setSettingsOpen,
    openSettings,
    dismissTop,
  };
}
