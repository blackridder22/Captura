import { useEffect, type RefObject } from "react";
import { hideMainWindow } from "../lib/api";
import { matchesShortcut } from "../lib/shortcuts";
import type { CaptureItem, KeyboardShortcutSettings } from "../types";

/// Window-level shortcut dispatcher. Owns no state; everything it reads is
/// received so state ownership stays single-homed.
type KeyboardShortcutDeps = {
  shortcuts: KeyboardShortcutSettings;
  editingItem: CaptureItem | null;
  settingsOpen: boolean;
  dismissTop: () => void;
  setEditingItem: (item: CaptureItem | null) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  selectedId: string | null;
  selectedIds: string[];
  selectedItems: CaptureItem[];
  moveBy: (direction: 1 | -1, extend: boolean) => void;
  copySelected: (asList: boolean) => Promise<void>;
  mergeSelected: () => Promise<void>;
  markSelectedDone: () => Promise<void>;
  handlePaste: (id: string) => Promise<void>;
  handleDeleteSelected: () => Promise<void>;
};

export function useKeyboardShortcuts({
  shortcuts,
  editingItem,
  settingsOpen,
  dismissTop,
  setEditingItem,
  searchRef,
  selectedId,
  selectedIds,
  selectedItems,
  moveBy,
  copySelected,
  mergeSelected,
  markSelectedDone,
  handlePaste,
  handleDeleteSelected,
}: KeyboardShortcutDeps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, shortcuts.dismiss)) {
        event.preventDefault();
        dismissTop();
        return;
      }

      if (matchesShortcut(event, shortcuts.close)) {
        event.preventDefault();
        void hideMainWindow();
        return;
      }

      if (matchesShortcut(event, shortcuts.search)) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, [contenteditable='true']") ||
        editingItem ||
        settingsOpen
      ) {
        return;
      }

      const movingNext = matchesShortcut(event, shortcuts.next, true);
      const movingPrevious = matchesShortcut(event, shortcuts.previous, true);
      if (movingNext || movingPrevious) {
        event.preventDefault();
        moveBy(movingNext ? 1 : -1, event.shiftKey);
        return;
      }

      if (matchesShortcut(event, shortcuts.copyAsList)) {
        event.preventDefault();
        void copySelected(true);
        return;
      }

      if (matchesShortcut(event, shortcuts.copy)) {
        event.preventDefault();
        void copySelected(false);
        return;
      }

      if (matchesShortcut(event, shortcuts.merge)) {
        event.preventDefault();
        void mergeSelected();
        return;
      }

      if (matchesShortcut(event, shortcuts.markDone) && selectedIds.length) {
        event.preventDefault();
        void markSelectedDone();
        return;
      }

      if (
        matchesShortcut(event, shortcuts.edit) &&
        selectedItems.length === 1
      ) {
        event.preventDefault();
        setEditingItem(selectedItems[0]!);
        return;
      }

      if (matchesShortcut(event, shortcuts.paste) && selectedId) {
        event.preventDefault();
        void handlePaste(selectedId);
        return;
      }

      if (matchesShortcut(event, shortcuts.delete) && selectedId) {
        event.preventDefault();
        void handleDeleteSelected();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    shortcuts,
    copySelected,
    dismissTop,
    editingItem,
    handleDeleteSelected,
    handlePaste,
    markSelectedDone,
    mergeSelected,
    moveBy,
    searchRef,
    selectedId,
    selectedIds,
    selectedItems,
    setEditingItem,
    settingsOpen,
  ]);
}
