import { useCallback, useRef } from "react";
import {
  createItem,
  createSection,
  deleteSection,
  deleteItems,
  moveItemsToSection,
  pasteItem,
  purgeItems,
  restoreItems,
  toggleItem,
} from "../lib/api";
import type {
  CaptureItem,
  ContextMenu,
  QueueFilter,
  Section,
  SectionFilter,
} from "../types";
import type { ToastAction, ToastTone } from "./use-notify";

/// Single-item and composer actions. UI state belongs to the owning hooks.
type ItemActionDeps = {
  prependItem: (item: CaptureItem) => void;
  prependDeduped: (item: CaptureItem) => void;
  replaceItem: (item: CaptureItem) => void;
  removeItems: (ids: string[]) => void;
  addSection: (section: Section) => void;
  removeSection: (id: string) => void;
  applyUpdatedItems: (updated: CaptureItem[]) => void;
  sectionFilter: SectionFilter;
  setFilter: (filter: QueueFilter) => void;
  setSectionFilter: (filter: SectionFilter) => void;
  setContextMenu: (menu: ContextMenu | null) => void;
  setSingle: (id: string) => void;
  announce: (text: string) => void;
  notify: (text: string, tone?: ToastTone, action?: ToastAction) => void;
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
  replaceItem,
  removeItems,
  addSection,
  removeSection,
  applyUpdatedItems,
  sectionFilter,
  setFilter,
  setSectionFilter,
  setContextMenu,
  setSingle,
  announce,
  notify,
  composer,
  composerKind,
  saving,
  setSaving,
  setComposer,
  focusComposer,
}: ItemActionDeps) {
  const saveInFlight = useRef(false);

  const handleCreate = useCallback(async () => {
    const content = composer;
    if (!content.trim() || saving || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    try {
      let created = await createItem({ content, kind: composerKind });
      let sectionMoveFailed = false;
      if (sectionFilter !== "all" && sectionFilter !== "unfiled") {
        try {
          created = (await moveItemsToSection([created.id], sectionFilter))[0] ?? created;
        } catch {
          // Creation already persisted. Keep it visible instead of inviting a duplicate save.
          sectionMoveFailed = true;
        }
      }
      prependItem(created);
      setSingle(created.id);
      setFilter("inbox");
      setComposer("");
      if (sectionMoveFailed) {
        setSectionFilter("unfiled");
        notify("Capture saved to Unfiled. Could not add it to this section.", "error");
      } else {
        announce("Capture saved");
      }
    } catch {
      notify("Could not save capture. Your draft is still here. Try again.", "error");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
      focusComposer();
    }
  }, [
    announce,
    composer,
    composerKind,
    focusComposer,
    notify,
    prependItem,
    saving,
    sectionFilter,
    setComposer,
    setFilter,
    setSaving,
    setSectionFilter,
    setSingle,
  ]);

  const handleToggle = useCallback(
    async (id: string) => {
      replaceItem(await toggleItem(id));
    },
    [replaceItem],
  );

  /// Row delete: Trash with Undo, or permanent when retention is Immediate.
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const result = await deleteItems([id]);
        if (result.purgedIds.length) {
          removeItems(result.purgedIds);
          announce("Capture deleted");
          return;
        }
        applyUpdatedItems(result.trashed);
        notify("Moved to Trash", "info", {
          label: "Undo",
          run: async () => {
            applyUpdatedItems(await restoreItems([id]));
            announce("Capture restored");
          },
        });
      } catch (error) {
        notify(typeof error === "string" ? error : "Could not delete this capture.", "error");
      }
    },
    [announce, applyUpdatedItems, notify, removeItems],
  );

  const handleRestore = useCallback(
    async (id: string) => {
      try {
        applyUpdatedItems(await restoreItems([id]));
        notify("Capture restored");
      } catch (error) {
        notify(typeof error === "string" ? error : "Could not restore this capture.", "error");
      }
    },
    [applyUpdatedItems, notify],
  );

  const handlePurge = useCallback(
    async (id: string) => {
      try {
        removeItems(await purgeItems([id]));
        announce("Capture deleted permanently");
      } catch (error) {
        notify(typeof error === "string" ? error : "Could not delete this capture.", "error");
      }
    },
    [announce, notify, removeItems],
  );

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

  const handleDeleteSection = useCallback(
    async (id: string) => {
      try {
        const updated = await deleteSection(id);
        removeSection(id);
        applyUpdatedItems(updated);
        if (sectionFilter === id) setSectionFilter("unfiled");
        setContextMenu(null);
        notify(
          `Section deleted. ${updated.length} capture${updated.length === 1 ? "" : "s"} moved to Unfiled.`,
        );
      } catch (error) {
        notify(
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "Could not delete this section.",
          "error",
        );
      }
    },
    [
      applyUpdatedItems,
      notify,
      removeSection,
      sectionFilter,
      setContextMenu,
      setSectionFilter,
    ],
  );

  return {
    handleCreate,
    handleToggle,
    handleDelete,
    handleRestore,
    handlePurge,
    handlePaste,
    handleCaptured,
    handleCreateSection,
    handleDeleteSection,
  };
}
