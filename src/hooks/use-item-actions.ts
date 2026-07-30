import { useCallback } from "react";
import {
  createItem,
  createSection,
  deleteItem,
  mergeItems,
  moveItemsToSection,
  pasteItem,
  toggleItem,
} from "../lib/api";
import type { CaptureItem, QueueFilter, SectionFilter } from "../types";
import type { ToastTone } from "./use-notify";

/// Stateless orchestration over the owning hooks: every piece of state it
/// touches is received, never owned.
type ItemActionDeps = {
  prependItem: (item: CaptureItem) => void;
  prependDeduped: (item: CaptureItem) => void;
  prependReplacing: (item: CaptureItem, replacedIds: string[]) => void;
  replaceItem: (item: CaptureItem) => void;
  removeItems: (ids: string[]) => void;
  applyUpdatedItems: (updated: CaptureItem[]) => void;
  addSection: (section: { id: string; name: string; createdAt: string }) => void;
  sectionFilter: SectionFilter;
  setFilter: (filter: QueueFilter) => void;
  setSectionFilter: (filter: SectionFilter) => void;
  selectedIds: string[];
  selectedItems: CaptureItem[];
  setSingle: (id: string) => void;
  clearSelection: () => void;
  setContextMenu: (menu: { x: number; y: number } | null) => void;
  announce: (text: string) => void;
  notify: (text: string, tone?: ToastTone) => void;
  composer: string;
  composerKind: CaptureItem["kind"];
  saving: boolean;
  setSaving: (saving: boolean) => void;
  setComposer: (content: string) => void;
  focusComposer: () => void;
};

export function useItemActions({
  prependItem,
  prependDeduped,
  prependReplacing,
  replaceItem,
  removeItems,
  applyUpdatedItems,
  addSection,
  sectionFilter,
  setFilter,
  setSectionFilter,
  selectedIds,
  selectedItems,
  setSingle,
  clearSelection,
  setContextMenu,
  announce,
  notify,
  composer,
  composerKind,
  saving,
  setSaving,
  setComposer,
  focusComposer,
}: ItemActionDeps) {
  const handleCreate = useCallback(async () => {
    const content = composer.trim();
    if (!content || saving) return;
    setSaving(true);
    const item = await createItem({ content, kind: composerKind });
    const created =
      sectionFilter !== "all" && sectionFilter !== "unfiled"
        ? (await moveItemsToSection([item.id], sectionFilter))[0] ?? item
        : item;
    prependItem(created);
    setSingle(created.id);
    setFilter("inbox");
    setComposer("");
    setSaving(false);
    announce("Capture saved");
    focusComposer();
  }, [
    announce,
    composer,
    composerKind,
    focusComposer,
    prependItem,
    saving,
    sectionFilter,
    setComposer,
    setFilter,
    setSaving,
    setSingle,
  ]);

  const handleToggle = useCallback(
    async (id: string) => {
      replaceItem(await toggleItem(id));
    },
    [replaceItem],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteItem(id);
      removeItems([id]);
      announce("Capture deleted");
    },
    [announce, removeItems],
  );

  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => deleteItem(id)));
    removeItems(ids);
    clearSelection();
    setContextMenu(null);
    announce(`${ids.length} capture${ids.length === 1 ? "" : "s"} deleted`);
  }, [announce, clearSelection, removeItems, selectedIds, setContextMenu]);

  const handlePaste = useCallback(
    async (id: string) => {
      try {
        replaceItem(await pasteItem(id));
        notify("Pasted into the previous app");
      } catch (error) {
        notify(
          typeof error === "string" ? error : "Paste failed. Try again.",
          "error",
        );
      }
    },
    [notify, replaceItem],
  );

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

  const handleCaptured = useCallback(
    (item: CaptureItem) => {
      prependDeduped(item);
      setFilter("inbox");
      setSingle(item.id);
      announce("Capture saved");
    },
    [announce, prependDeduped, setFilter, setSingle],
  );

  const handleCreateSection = useCallback(
    async (name: string) => {
      const section = await createSection(name);
      addSection(section);
      setSectionFilter(section.id);
      announce("Section created");
    },
    [addSection, announce, setSectionFilter],
  );

  return {
    handleCreate,
    handleToggle,
    handleDelete,
    handleDeleteSelected,
    handlePaste,
    copySelected,
    markSelectedDone,
    mergeSelected,
    moveSelected,
    handleCaptured,
    handleCreateSection,
  };
}
