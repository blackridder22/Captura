import { ArrowDown, ArrowUp, Inbox, Keyboard } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  captureClipboardNow,
  createSection,
  createItem,
  deleteItem,
  hideMainWindow,
  mergeItems,
  moveItemsToSection,
  onCaptured,
  onFocusComposer,
  pasteItem,
  quitApp,
  requestAccessibility,
  resetShortcuts,
  setKeepOpen,
  setShortcut,
  toggleItem,
  updateItem,
} from "./lib/api";
import { moveSelection, resolveSelection } from "./lib/selection";
import { matchesShortcut, shortcutLabel } from "./lib/shortcuts";
import type { CaptureItem } from "./types";
import { useComposer } from "./hooks/use-composer";
import { useNotify } from "./hooks/use-notify";
import { useOverlays } from "./hooks/use-overlays";
import { usePermissions } from "./hooks/use-permissions";
import { useQueueData } from "./hooks/use-queue-data";
import { useQueueFilters } from "./hooks/use-queue-filters";
import { EditSheet } from "./components/edit-sheet";
import { FilterTabs } from "./components/filter-tabs";
import { PreviewSheet } from "./components/preview-sheet";
import { QuickCapture } from "./components/quick-capture";
import { QueueContextMenu } from "./components/queue-context-menu";
import { QueueHeader } from "./components/queue-header";
import { QueueItem } from "./components/queue-item";
import {
  SectionBar,
  type SectionFilter,
} from "./components/section-bar";
import { SettingsSheet } from "./components/settings-sheet";
import { Kbd } from "./components/ui/kbd";

export default function App() {
  const {
    items,
    sections,
    loading,
    appSettings,
    setAppSettings,
    refreshData,
    prependItem,
    prependDeduped,
    prependReplacing,
    replaceItem,
    removeItems,
    applyUpdatedItems,
    addSection,
    sectionNames,
  } = useQueueData();
  const {
    filter,
    setFilter,
    query,
    setQuery,
    sectionFilter,
    setSectionFilter,
    visibleItems,
    counts,
  } = useQueueFilters(items);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const {
    composer,
    setComposer,
    composerKind,
    setComposerKind,
    saving,
    setSaving,
    composerRef,
    focusComposer,
  } = useComposer();
  const {
    editingItem,
    setEditingItem,
    previewItems,
    setPreviewItems,
    contextMenu,
    setContextMenu,
    settingsOpen,
    setSettingsOpen,
    dismissTop,
  } = useOverlays();
  const { permissions, refreshPermissions } = usePermissions(settingsOpen);
  const { announcement, toast, announce, notify } = useNotify();
  const searchRef = useRef<HTMLInputElement>(null);
  const selectionAnchorRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const nextItems = await refreshData();
    setSelectedId((current) => current ?? nextItems[0]?.id ?? null);
    setSelectedIds((current) =>
      current.length ? current : nextItems[0] ? [nextItems[0].id] : [],
    );
    if (!selectionAnchorRef.current) {
      selectionAnchorRef.current = nextItems[0]?.id ?? null;
    }
  }, [refreshData]);

  useEffect(() => {
    void refresh();
    void refreshPermissions();

    let stopCapture: () => void = () => {};
    let stopFocus: () => void = () => {};
    void onCaptured((item) => {
      prependDeduped(item);
      setFilter("inbox");
      setSelectedId(item.id);
      setSelectedIds([item.id]);
      selectionAnchorRef.current = item.id;
      announce("Capture saved");
    }).then((off) => {
      stopCapture = off;
    });
    void onFocusComposer(() => {
      focusComposer();
    }).then((off) => {
      stopFocus = off;
    });

    const handleFocus = () => {
      void refresh();
      void refreshPermissions();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      stopCapture();
      stopFocus();
      window.removeEventListener("focus", handleFocus);
    };
  }, [focusComposer, prependDeduped, refresh, refreshPermissions, setFilter]);

  useEffect(() => {
    if (!visibleItems.length) {
      setSelectedId(null);
      setSelectedIds([]);
      selectionAnchorRef.current = null;
      return;
    }
    if (!visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0]!.id);
      setSelectedIds([visibleItems[0]!.id]);
      selectionAnchorRef.current = visibleItems[0]!.id;
      return;
    }
    setSelectedIds((current) => {
      const next = current.filter((id) =>
        visibleItems.some((item) => item.id === id),
      );
      if (
        selectionAnchorRef.current &&
        !visibleItems.some((item) => item.id === selectionAnchorRef.current)
      ) {
        selectionAnchorRef.current = selectedId;
      }
      return next;
    });
  }, [selectedId, visibleItems]);

  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedIds.includes(item.id)),
    [selectedIds, visibleItems],
  );

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
    setSelectedId(created.id);
    setSelectedIds([created.id]);
    selectionAnchorRef.current = created.id;
    setFilter("inbox");
    setComposer("");
    setSaving(false);
    announce("Capture saved");
    focusComposer();
  }, [composer, composerKind, saving, sectionFilter]);

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
    setSelectedIds([]);
    setSelectedId(null);
    selectionAnchorRef.current = null;
    setContextMenu(null);
    announce(`${ids.length} capture${ids.length === 1 ? "" : "s"} deleted`);
  }, [selectedIds]);

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

  const selectItem = useCallback(
    (id: string, options: { toggle: boolean; range: boolean }) => {
      const next = resolveSelection({
        orderedIds: visibleItems.map((item) => item.id),
        selectedIds,
        focusedId: selectedId,
        anchorId: selectionAnchorRef.current,
        targetId: id,
        toggle: options.toggle,
        range: options.range,
      });
      setSelectedId(next.focusedId);
      setSelectedIds(next.selectedIds);
      selectionAnchorRef.current = next.anchorId;
    },
    [selectedId, selectedIds, visibleItems],
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
    [selectedItems],
  );

  const markSelectedDone = useCallback(async () => {
    const openItems = selectedItems.filter((item) => item.status === "open");
    const updated = await Promise.all(openItems.map((item) => toggleItem(item.id)));
    applyUpdatedItems(updated);
    setContextMenu(null);
    announce("Marked as done");
  }, [announce, applyUpdatedItems, selectedItems, setContextMenu]);

  const mergeSelected = useCallback(async () => {
    if (selectedIds.length < 2) return;
    const ids = [...selectedIds];
    const merged = await mergeItems(ids);
    prependReplacing(merged, ids);
    setSelectedId(merged.id);
    setSelectedIds([merged.id]);
    selectionAnchorRef.current = merged.id;
    setContextMenu(null);
    announce("Notes merged");
  }, [selectedIds]);

  const moveSelected = useCallback(
    async (sectionId: string | null) => {
      const updated = await moveItemsToSection(selectedIds, sectionId);
      applyUpdatedItems(updated);
      setContextMenu(null);
      announce(sectionId ? "Moved to section" : "Moved to Unfiled");
    },
    [announce, applyUpdatedItems, selectedIds, setContextMenu],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcuts = appSettings.shortcuts;

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
        const next = moveSelection({
          orderedIds: visibleItems.map((item) => item.id),
          selectedIds,
          focusedId: selectedId,
          anchorId: selectionAnchorRef.current,
          direction: movingNext ? 1 : -1,
          extend: event.shiftKey,
        });
        setSelectedId(next.focusedId);
        setSelectedIds(next.selectedIds);
        selectionAnchorRef.current = next.anchorId;
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
    appSettings.shortcuts,
    copySelected,
    dismissTop,
    editingItem,
    handleDeleteSelected,
    handlePaste,
    markSelectedDone,
    mergeSelected,
    selectedId,
    selectedIds,
    selectedItems,
    settingsOpen,
    visibleItems,
  ]);

  return (
    <main
      className="app-frame"
      onMouseDown={() => contextMenu && setContextMenu(null)}
    >
      <section className="captura-panel" aria-label="Captura queue">
        <QueueHeader
          query={query}
          onQueryChange={setQuery}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => void hideMainWindow()}
          searchRef={searchRef}
          searchShortcut={appSettings.shortcuts.search}
          closeShortcut={appSettings.shortcuts.close}
        />

        <QuickCapture
          content={composer}
          kind={composerKind}
          onContentChange={setComposer}
          onKindChange={setComposerKind}
          onSubmit={handleCreate}
          composerRef={composerRef}
          saving={saving}
          saveShortcut={appSettings.shortcuts.save}
        />

        <FilterTabs active={filter} counts={counts} onChange={setFilter} />
        <SectionBar
          sections={sections}
          active={sectionFilter}
          onChange={setSectionFilter}
          onCreate={async (name) => {
            const section = await createSection(name);
            addSection(section);
            setSectionFilter(section.id);
            announce("Section created");
          }}
        />

        <section
          className="queue-list"
          role="listbox"
          aria-label="Captured items"
          aria-multiselectable="true"
        >
          {loading ? (
            <div className="loading-list" aria-label="Loading captures">
              <i />
              <i />
              <i />
            </div>
          ) : visibleItems.length ? (
            visibleItems.map((item) => (
              <QueueItem
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                multiSelected={selectedIds.includes(item.id)}
                sectionName={
                  item.sectionId ? sectionNames.get(item.sectionId) : undefined
                }
                onSelect={(event) =>
                  selectItem(item.id, {
                    toggle: event.metaKey || event.ctrlKey,
                    range: event.shiftKey,
                  })
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!selectedIds.includes(item.id)) {
                    setSelectedId(item.id);
                    setSelectedIds([item.id]);
                    selectionAnchorRef.current = item.id;
                  }
                  setContextMenu({ x: event.clientX, y: event.clientY });
                }}
                onToggle={() => void handleToggle(item.id)}
                onEdit={() => setEditingItem(item)}
                onDelete={() => void handleDelete(item.id)}
                onCopy={() => {
                  void navigator.clipboard.writeText(item.content);
                  announce("Copied");
                }}
                onPaste={() => void handlePaste(item.id)}
                pasteShortcut={appSettings.shortcuts.paste}
              />
            ))
          ) : (
            <div className="empty-state">
              <span>
                <Inbox size={20} strokeWidth={1.6} />
              </span>
              <strong>
                {query ? "Nothing matches that search." : "Your queue is clear."}
              </strong>
              <p>
                {query
                  ? "Try a different word or filter."
                  : `Select anything, press ${shortcutLabel(appSettings.shortcuts.capture)}, and keep moving.`}
              </p>
            </div>
          )}
        </section>

        <footer className="shortcut-strip">
          <span>
            <Keyboard size={12} />
            <Kbd>{shortcutLabel(appSettings.shortcuts.capture)}</Kbd>
            capture
          </span>
          <i />
          <span>
            <Kbd>{shortcutLabel(appSettings.shortcuts.paste)}</Kbd>
            paste
          </span>
          <i />
          <span>
            {appSettings.shortcuts.previous === "ArrowUp" ? (
              <ArrowUp size={11} />
            ) : (
              <Kbd>{shortcutLabel(appSettings.shortcuts.previous)}</Kbd>
            )}
            {appSettings.shortcuts.next === "ArrowDown" ? (
              <ArrowDown size={11} />
            ) : (
              <Kbd>{shortcutLabel(appSettings.shortcuts.next)}</Kbd>
            )}
            navigate
          </span>
        </footer>
      </section>

      {contextMenu ? (
        <QueueContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          count={selectedItems.length}
          sections={sections}
          shortcuts={appSettings.shortcuts}
          onCopy={() => void copySelected(false)}
          onCopyAsList={() => void copySelected(true)}
          onDone={() => void markSelectedDone()}
          onExpand={() => {
            setPreviewItems(selectedItems);
            setContextMenu(null);
          }}
          onEdit={() => {
            if (selectedItems[0]) setEditingItem(selectedItems[0]);
            setContextMenu(null);
          }}
          onMerge={() => void mergeSelected()}
          onMove={(sectionId) => void moveSelected(sectionId)}
          onDelete={() => void handleDeleteSelected()}
        />
      ) : null}

      {previewItems.length ? (
        <PreviewSheet
          items={previewItems}
          onClose={() => setPreviewItems([])}
          onEdit={
            previewItems.length === 1
              ? () => {
                  setEditingItem(previewItems[0]!);
                  setPreviewItems([]);
                }
              : null
          }
        />
      ) : null}

      {editingItem ? (
        <EditSheet
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={async (content, kind) => {
            replaceItem(
              await updateItem({ id: editingItem.id, content, kind }),
            );
            setEditingItem(null);
            announce("Capture updated");
          }}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsSheet
          permissions={permissions}
          settings={appSettings}
          onClose={() => setSettingsOpen(false)}
          onRequestAccessibility={async () => {
            await requestAccessibility();
            await refreshPermissions();
          }}
          onShortcutChange={async (action, shortcut) => {
            setAppSettings(await setShortcut(action, shortcut));
            if (action === "capture") {
              await refreshPermissions();
            }
            notify("Shortcut updated");
          }}
          onResetShortcuts={async () => {
            try {
              setAppSettings(await resetShortcuts());
              await refreshPermissions();
              notify("Default shortcuts restored");
            } catch (error) {
              notify(
                typeof error === "string"
                  ? error
                  : "Could not restore default shortcuts.",
                "error",
              );
            }
          }}
          onKeepOpenChange={async (keepOpen) => {
            setAppSettings(await setKeepOpen(keepOpen));
            announce(
              keepOpen
                ? "Captura will stay open"
                : "Captura will close when you click away",
            );
          }}
          onCaptureClipboard={async () => {
            await captureClipboardNow();
            announce("Clipboard captured");
          }}
          onQuit={quitApp}
        />
      ) : null}

      {toast ? (
        <div className="app-toast" data-tone={toast.tone} role="status">
          {toast.text}
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </main>
  );
}
