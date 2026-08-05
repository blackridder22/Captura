import { useCallback } from "react";
import {
  copyItems,
  deleteItem,
  mergeItems,
  moveItemsToSection,
  toggleItem,
} from "../lib/api";
import type { CaptureItem, ContextMenu } from "../types";
import type { ToastTone } from "./use-notify";

/// Selection-wide actions. Stateless; every bulk action closes the context
/// menu because they are its menu entries.
type BulkActionDeps = {
  removeItems: (ids: string[]) => void;
  applyUpdatedItems: (updated: CaptureItem[]) => void;
  prependReplacing: (item: CaptureItem, replacedIds: string[]) => void;
  selectedIds: string[];
  selectedItems: CaptureItem[];
  setSingle: (id: string) => void;
  clearSelection: () => void;
  setContextMenu: (menu: ContextMenu | null) => void;
  announce: (text: string) => void;
  notify: (text: string, tone?: ToastTone) => void;
};

function copyErrorMessage(error: unknown) {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Could not copy this capture.";
}

export function useBulkActions({
  removeItems,
  applyUpdatedItems,
  prependReplacing,
  selectedIds,
  selectedItems,
  setSingle,
  clearSelection,
  setContextMenu,
  announce,
  notify,
}: BulkActionDeps) {
  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => deleteItem(id)));
    removeItems(ids);
    clearSelection();
    setContextMenu(null);
    announce(`${ids.length} capture${ids.length === 1 ? "" : "s"} deleted`);
  }, [announce, clearSelection, removeItems, selectedIds, setContextMenu]);

  const copySelected = useCallback(
    async (asList: boolean) => {
      if (!selectedItems.length) return;
      const mode = asList
        ? "markdownList"
        : selectedItems.length === 1 && selectedItems[0]?.kind === "image"
          ? "native"
          : "sourceMarkdown";
      try {
        const result = await copyItems(
          selectedItems.map((item) => item.id),
          mode,
        );
        setContextMenu(null);
        notify(
          result.format === "image"
            ? "Image copied"
            : result.format === "markdownList"
              ? "Copied as Markdown list"
              : "Copied as Markdown",
        );
      } catch (error) {
        notify(copyErrorMessage(error), "error");
      }
    },
    [notify, selectedItems, setContextMenu],
  );

  const copyItem = useCallback(
    async (id: string) => {
      try {
        await copyItems([id], "native");
      } catch (error) {
        notify(copyErrorMessage(error), "error");
        throw error;
      }
    },
    [notify],
  );

  const markSelectedDone = useCallback(async () => {
    const openItems = selectedItems.filter((item) => item.status === "open");
    const updated = await Promise.all(
      openItems.map((item) => toggleItem(item.id)),
    );
    applyUpdatedItems(updated);
    setContextMenu(null);
    announce("Marked as done");
  }, [announce, applyUpdatedItems, selectedItems, setContextMenu]);

  const mergeSelected = useCallback(async () => {
    if (selectedIds.length < 2) return;
    const ids = [...selectedIds];
    const merged = await mergeItems(ids);
    prependReplacing(merged, ids);
    setSingle(merged.id);
    setContextMenu(null);
    announce("Notes merged");
  }, [announce, prependReplacing, selectedIds, setContextMenu, setSingle]);

  const moveSelected = useCallback(
    async (sectionId: string | null) => {
      const updated = await moveItemsToSection(selectedIds, sectionId);
      applyUpdatedItems(updated);
      setContextMenu(null);
      announce(sectionId ? "Moved to section" : "Moved to Unfiled");
    },
    [announce, applyUpdatedItems, selectedIds, setContextMenu],
  );

  return {
    handleDeleteSelected,
    copyItem,
    copySelected,
    markSelectedDone,
    mergeSelected,
    moveSelected,
  };
}
