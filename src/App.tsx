import { ArrowDown, ArrowUp, Inbox, Keyboard } from "lucide-react";
import { useCallback, useRef } from "react";
import { hideMainWindow, quitApp, updateItem } from "./lib/api";
import { shortcutLabel } from "./lib/shortcuts";
import { useAppEvents } from "./hooks/use-app-events";
import { useBulkActions } from "./hooks/use-bulk-actions";
import { useComposer } from "./hooks/use-composer";
import { useItemActions } from "./hooks/use-item-actions";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useNotify } from "./hooks/use-notify";
import { useOverlays } from "./hooks/use-overlays";
import { usePermissions } from "./hooks/use-permissions";
import { useQueueData } from "./hooks/use-queue-data";
import { useQueueFilters } from "./hooks/use-queue-filters";
import { useSelection } from "./hooks/use-selection";
import { useSettingsActions } from "./hooks/use-settings-actions";
import { useUpdater } from "./hooks/use-updater";
import { EditSheet } from "./components/edit-sheet";
import { FilterTabs } from "./components/filter-tabs";
import { PreviewSheet } from "./components/preview-sheet";
import { QuickCapture } from "./components/quick-capture";
import { QueueContextMenu } from "./components/queue-context-menu";
import { QueueHeader } from "./components/queue-header";
import { QueueItem } from "./components/queue-item";
import { SectionBar } from "./components/section-bar";
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
  const {
    selectedId,
    selectedIds,
    selectedItems,
    seedIfEmpty,
    setSingle,
    clear: clearSelection,
    selectWith,
    moveBy,
    isSelected,
  } = useSelection(visibleItems);
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
    openSettings,
    dismissTop,
  } = useOverlays();
  const { permissions, refreshPermissions } = usePermissions(settingsOpen);
  const { announcement, toast, announce, notify } = useNotify();
  const {
    status: updateStatus,
    checkForUpdates,
    installUpdate,
  } = useUpdater({ notify });
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const nextItems = await refreshData();
    seedIfEmpty(nextItems[0]?.id ?? null);
  }, [refreshData, seedIfEmpty]);

  const {
    handleCreate,
    handleToggle,
    handleDelete,
    handlePaste,
    handleCaptured,
    handleCreateSection,
  } = useItemActions({
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
  });

  const {
    handleDeleteSelected,
    copySelected,
    markSelectedDone,
    mergeSelected,
    moveSelected,
  } = useBulkActions({
    removeItems,
    applyUpdatedItems,
    prependReplacing,
    selectedIds,
    selectedItems,
    setSingle,
    clearSelection,
    setContextMenu,
    announce,
  });

  const {
    requestAccessibilityAndRefresh,
    changeShortcut,
    resetAllShortcuts,
    changeKeepOpen,
    captureClipboard,
  } = useSettingsActions({
    setAppSettings,
    refreshPermissions,
    announce,
    notify,
  });

  useAppEvents({
    refresh,
    refreshPermissions,
    onCapturedItem: handleCaptured,
    focusComposer,
  });

  useKeyboardShortcuts({
    shortcuts: appSettings.shortcuts,
    editingItem,
    settingsOpen,
    dismissTop,
    openSettings,
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
  });

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
          onCreate={handleCreateSection}
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
                  selectWith(item.id, {
                    toggle: event.metaKey || event.ctrlKey,
                    range: event.shiftKey,
                  })
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!isSelected(item.id)) {
                    setSingle(item.id);
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
          onRequestAccessibility={requestAccessibilityAndRefresh}
          onShortcutChange={changeShortcut}
          onResetShortcuts={resetAllShortcuts}
          onKeepOpenChange={changeKeepOpen}
          onCaptureClipboard={captureClipboard}
          onQuit={quitApp}
          updateStatus={updateStatus}
          onCheckUpdates={() => checkForUpdates(false)}
          onInstallUpdate={installUpdate}
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
