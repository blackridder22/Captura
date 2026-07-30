import { useCallback } from "react";
import {
  createItem,
  createSection,
  deleteItem,
  moveItemsToSection,
  pasteItem,
  toggleItem,
} from "../lib/api";
import type { CaptureItem, QueueFilter, Section, SectionFilter } from "../types";
import type { ToastTone } from "./use-notify";

/// Single-item and composer actions. Stateless orchestration over the
/// owning hooks: every piece of state it touches is received, never owned.
type ItemActionDeps = {
  prependItem: (item: CaptureItem) => void;
  prependDeduped: (item: CaptureItem) => void;
  replaceItem: (item: CaptureItem) => void;
  removeItems: (ids: string[]) => void;
  addSection: (section: Section) => void;
  sectionFilter: SectionFilter;
  setFilter: (filter: QueueFilter) => void;
  setSectionFilter: (filter: SectionFilter) => void;
  setSingle: (id: string) => void;
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
  replaceItem,
  removeItems,
  addSection,
  sectionFilter,
  setFilter,
  setSectionFilter,
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

  return {
    handleCreate,
    handleToggle,
    handleDelete,
    handlePaste,
    handleCaptured,
    handleCreateSection,
  };
}
