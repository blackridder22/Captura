import { useCallback } from "react";
import { deleteItem, mergeItems, moveItemsToSection, toggleItem } from "../lib/api";
import type { CaptureItem } from "../types";

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
  setContextMenu: (menu: { x: number; y: number } | null) => void;
  announce: (text: string) => void;
};

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
      const content = asList
        ? selectedItems
            .map((item) => `- ${item.content.trim().replace(/\n+/g, " ")}`)
            .join("\n")
        : selectedItems.map((item) => item.content).join("\n\n");
      await navigator.clipboard.writeText(content);
      setContextMenu(null);
      announce(asList ? "Copied as list" : "Copied");
    },
    [announce, selectedItems, setContextMenu],
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
    copySelected,
    markSelectedDone,
    mergeSelected,
    moveSelected,
  };
}
