import { useEffect, type RefObject } from "react";
import { hideMainWindow } from "../lib/api";
import { matchesShortcut } from "../lib/shortcuts";
import type { CaptureItem, KeyboardShortcutSettings } from "../types";

/// Window-level shortcut dispatcher. Owns no state; everything it reads is
/// received so state ownership stays single-homed.
type KeyboardShortcutDeps = {
  shortcuts: KeyboardShortcutSettings;
  blocked: boolean;
  suspended?: boolean;
  dismissTop: () => void;
  openSettings: () => void;
  onEdit: (item: CaptureItem) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  selectedId: string | null;
  selectedIds: string[];
  selectedItems: CaptureItem[];
  moveBy: (direction: 1 | -1, preserveSelection: boolean) => void;
  selectAll: () => void;
  copySelected: (asList: boolean) => Promise<void>;
  mergeSelected: () => Promise<void>;
  markSelectedDone: () => Promise<void>;
  handlePaste: (id: string) => Promise<void>;
  handleDeleteSelected: () => Promise<void>;
  /// Trash view: Enter/paste/done are inert and Delete purges.
  inTrash?: boolean;
  purgeSelected?: () => Promise<void>;
};

export function useKeyboardShortcuts({
  shortcuts,
  blocked,
  suspended = false,
  dismissTop,
  openSettings,
  onEdit,
  searchRef,
  selectedId,
  selectedIds,
  selectedItems,
  moveBy,
  selectAll,
  copySelected,
  mergeSelected,
  markSelectedDone,
  handlePaste,
  handleDeleteSelected,
  inTrash = false,
  purgeSelected,
}: KeyboardShortcutDeps) {
  useEffect(() => {
    if (suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (matchesShortcut(event, shortcuts.dismiss)) {
        event.preventDefault();
        dismissTop();
        return;
      }

      // Menus and overlays own their keyboard interaction, including text
      // selection. Queue shortcuts must never run behind them.
      if (blocked) return;

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

      // Like the shortcuts above, this works even while typing — the
      // platform convention for the preferences shortcut.
      if (matchesShortcut(event, shortcuts.settings)) {
        event.preventDefault();
        openSettings();
        return;
      }

      // Text surfaces keep their native keys, ⌘A included (CodeMirror and
      // ProseMirror both render contenteditable roots).
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest("input, textarea, [contenteditable='true'], .cm-editor, .ProseMirror")
      ) {
        return;
      }

      if (matchesShortcut(event, shortcuts.selectAll)) {
        event.preventDefault();
        selectAll();
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
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        void copySelected(false);
        return;
      }

      if (inTrash) {
        if (matchesShortcut(event, shortcuts.delete) && selectedId) {
          event.preventDefault();
          void purgeSelected?.();
        }
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
        onEdit(selectedItems[0]!);
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
    blocked,
    suspended,
    handleDeleteSelected,
    handlePaste,
    markSelectedDone,
    mergeSelected,
    moveBy,
    selectAll,
    openSettings,
    searchRef,
    selectedId,
    selectedIds,
    selectedItems,
    onEdit,
    inTrash,
    purgeSelected,
  ]);
}
