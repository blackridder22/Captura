import { useCallback } from "react";
import {
  copyItems,
  deleteItems,
  emptyTrash,
  mergeItems,
  moveItemsToSection,
  purgeItems,
  restoreItems,
  setItemsStatus,
} from "../lib/api";
import type { CaptureItem, ContextMenu } from "../types";
import type { ToastAction, ToastTone } from "./use-notify";

/// Selection-wide actions. Stateless; every bulk action closes the context
/// menu because they are its menu entries. Each one is a single IPC call.
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
  notify: (text: string, tone?: ToastTone, action?: ToastAction) => void;
};

function copyErrorMessage(error: unknown) {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Could not copy this capture.";
}

function plural(count: number, noun = "capture") {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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
  const restoreIds = useCallback(
    async (ids: string[]) => {
      const restored = await restoreItems(ids);
      applyUpdatedItems(restored);
      notify(`${plural(restored.length)} restored`);
    },
    [applyUpdatedItems, notify],
  );

  /// Delete follows the retention setting: Trash (with Undo) or permanent.
  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      const result = await deleteItems(ids);
      if (result.purgedIds.length) removeItems(result.purgedIds);
      if (result.trashed.length) applyUpdatedItems(result.trashed);
      clearSelection();
      setContextMenu(null);
      if (result.trashed.length) {
        const trashedIds = result.trashed.map((item) => item.id);
        notify(`${plural(trashedIds.length)} moved to Trash`, "info", {
          label: "Undo",
          run: () => restoreIds(trashedIds),
        });
      } else {
        announce(`${plural(result.purgedIds.length)} deleted`);
      }
    } catch (error) {
      notify(copyErrorMessage(error), "error");
    }
  }, [announce, applyUpdatedItems, clearSelection, notify, removeItems, restoreIds, selectedIds, setContextMenu]);

  const restoreSelected = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      await restoreIds(ids);
      clearSelection();
      setContextMenu(null);
    } catch (error) {
      notify(copyErrorMessage(error), "error");
    }
  }, [clearSelection, notify, restoreIds, selectedIds, setContextMenu]);

  const purgeSelected = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      const purged = await purgeItems(ids);
      removeItems(purged);
      clearSelection();
      setContextMenu(null);
      announce(`${plural(purged.length)} deleted permanently`);
    } catch (error) {
      notify(copyErrorMessage(error), "error");
    }
  }, [announce, clearSelection, notify, removeItems, selectedIds, setContextMenu]);

  const emptyAllTrash = useCallback(async () => {
    try {
      const purged = await emptyTrash();
      removeItems(purged);
      clearSelection();
      notify(purged.length ? `Trash emptied · ${plural(purged.length)} deleted` : "Trash is already empty");
    } catch (error) {
      notify(copyErrorMessage(error), "error");
    }
  }, [clearSelection, notify, removeItems]);

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
    const openIds = selectedItems.filter((item) => item.status === "open").map((item) => item.id);
    if (openIds.length) {
      applyUpdatedItems(await setItemsStatus(openIds, "done"));
    }
    setContextMenu(null);
    announce("Marked as done");
  }, [announce, applyUpdatedItems, selectedItems, setContextMenu]);

  const mergeSelected = useCallback(async () => {
    if (selectedIds.length < 2) return;
    const ids = [...selectedIds];
    const merged = await mergeItems(ids);
    // Sources are trashed (or purged); the native event carries their rows.
    // Removing them locally keeps the list right even before it arrives.
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
    restoreSelected,
    purgeSelected,
    emptyAllTrash,
    copyItem,
    copySelected,
    markSelectedDone,
    mergeSelected,
    moveSelected,
  };
}
