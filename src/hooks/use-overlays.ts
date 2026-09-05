import { useCallback, useState } from "react";
import { hideMainWindow } from "../lib/api";
import type { ContextMenu } from "../types";

export function useOverlays() {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  const dismissTop = useCallback(() => {
    if (contextMenu) {
      setContextMenu(null);
    } else if (settingsOpen) {
      setSettingsOpen(false);
    } else {
      void hideMainWindow();
    }
  }, [contextMenu, settingsOpen]);

  return {
    contextMenu,
    setContextMenu,
    settingsOpen,
    setSettingsOpen,
    openSettings,
    dismissTop,
  };
}
