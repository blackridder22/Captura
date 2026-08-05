import { useCallback, useState } from "react";
import { hideMainWindow } from "../lib/api";
import type { CaptureItem, ContextMenu } from "../types";

export function useOverlays() {
  const [editingItem, setEditingItem] = useState<CaptureItem | null>(null);
  const [previewItems, setPreviewItems] = useState<CaptureItem[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  // The overlays behave as a z-stack; dismiss order is part of the app's
  // interaction contract: menu > preview > editor > settings > hide window.
  const dismissTop = useCallback(() => {
    if (contextMenu) {
      setContextMenu(null);
    } else if (previewItems.length) {
      setPreviewItems([]);
    } else if (editingItem) {
      setEditingItem(null);
    } else if (settingsOpen) {
      setSettingsOpen(false);
    } else {
      void hideMainWindow();
    }
  }, [contextMenu, editingItem, previewItems.length, settingsOpen]);

  return {
    editingItem,
    setEditingItem,
    previewItems,
    setPreviewItems,
    contextMenu,
    setContextMenu,
    settingsOpen,
    setSettingsOpen,
    openSettings,
    dismissTop,
  };
}
