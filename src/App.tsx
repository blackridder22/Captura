import { ArrowDown, ArrowUp, Inbox, Keyboard, ListChecks, Trash2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { cleanupImageFiles, hideMainWindow, purgeExpiredTrash, quitApp } from "./lib/api";
import type { CaptureDetailRequest, CaptureItem } from "./types";
import { shortcutLabel } from "./lib/shortcuts";
import { trashRetentionLabel } from "./lib/items";
import { useAppEvents } from "./hooks/use-app-events";
import { useBulkActions } from "./hooks/use-bulk-actions";
import { useComposer } from "./hooks/use-composer";
import { useImageImport } from "./hooks/use-image-import";
import { useImageThumbnails } from "./hooks/use-image-thumbnails";
import { useItemActions } from "./hooks/use-item-actions";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useNotify } from "./hooks/use-notify";
import { useOverlays } from "./hooks/use-overlays";
import { usePermissions } from "./hooks/use-permissions";
import { useQueueData } from "./hooks/use-queue-data";
import { useQueueFilters } from "./hooks/use-queue-filters";
import { useSelection } from "./hooks/use-selection";
import { useSettingsActions } from "./hooks/use-settings-actions";
import { useShiftSelectionMode } from "./hooks/use-shift-selection-mode";
import { useStableCallback } from "./hooks/use-stable-callback";
import { useUpdater } from "./hooks/use-updater";
import { PermissionBanner } from "./components/permission-banner";
import { FilterTabs } from "./components/filter-tabs";
import { QuickCapture } from "./components/quick-capture";
import { QueueContextMenu } from "./components/queue-context-menu";
import { QueueHeader } from "./components/queue-header";
import { QueueItem } from "./components/queue-item";
import { SectionBar } from "./components/section-bar";
import { SectionContextMenu } from "./components/section-context-menu";
import { SettingsSheet } from "./components/settings-sheet";
import { WelcomeSetup } from "./components/welcome-setup";
import { Button } from "./components/ui/button";
import { Kbd } from "./components/ui/kbd";
import { ImageImportMenu } from "./components/image-import-menu";
import { ImageImportFeedback } from "./components/image-import-feedback";

const CaptureSheet = lazy(() => import("./components/capture-sheet"));

export default function App() {
  const {
    items,
    sections,
    loading,
    appSettings,
    storageWarning,
    setAppSettings,
    refreshData,
    prependItem,
    prependDeduped,
    prependReplacing,
    replaceItem,
    removeItems,
    applyUpdatedItems,
    addSection,
    removeSection,
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
  const inTrash = filter === "trash";
  const {
    selectedId,
    selectedIds,
    selectedIdSet,
    actionIds,
    actionItems,
    seedIfEmpty,
    setSingle,
    clear: clearSelection,
    clearMultiSelection,
    selectAll,
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
    contextMenu,
    setContextMenu,
    settingsOpen,
    setSettingsOpen,
    openSettings,
    dismissTop,
  } = useOverlays({ hasMultiSelection: selectedIds.length > 0, clearSelection: clearMultiSelection });
  const {
    permissions,
    experience: permissionExperience,
    refreshPermissions,
    completeSetup,
    continueInLimitedMode,
    handlePermissionRequired,
  } = usePermissions(settingsOpen);
  const { announcement, toast, announce, notify, dismissToast } = useNotify();
  const {
    status: updateStatus,
    checkForUpdates,
    installUpdate,
  } = useUpdater({ notify });
  const showImportedImages = useCallback(() => setFilter("inbox"), [setFilter]);
  const imageImport = useImageImport({ sectionFilter, notify, onSuccess: showImportedImages });
  const queueRef = useRef<HTMLElement>(null);
  const failedThumbnails = useImageThumbnails(queueRef, visibleItems, applyUpdatedItems);
  useEffect(() => {
    if (loading) return;
    // Maintenance waits for two painted frames so the first render stays clean.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void cleanupImageFiles().catch((error) => console.warn("Image file cleanup failed", error));
        void purgeExpiredTrash().then((purged) => { if (purged.length) removeItems(purged); }).catch((error) => console.warn("Trash purge failed", error));
      });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [loading, removeItems]);
  const shiftSelectionMode = useShiftSelectionMode();
  const searchRef = useRef<HTMLInputElement>(null);
  const [captureRequest, setCaptureRequest] = useState<CaptureDetailRequest | null>(null);
  const captureRequestRef = useRef(captureRequest);
  captureRequestRef.current = captureRequest;
  const captureOpener = useRef<HTMLElement | null>(null);
  const [confirmingEmptyTrash, setConfirmingEmptyTrash] = useState(false);
  useEffect(() => { if (!inTrash) setConfirmingEmptyTrash(false); }, [inTrash]);
  const openDetail = useCallback((ids: string[], mode: "preview" | "edit") => {
    if (!ids.length) return;
    captureOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setContextMenu(null);
    setCaptureRequest({ ids, mode });
  }, [setContextMenu]);
  const closeDetail = useCallback(() => {
    setCaptureRequest(null);
    requestAnimationFrame(() => captureOpener.current?.focus({ preventScroll: true }));
  }, []);
  const focusQueueComposer = useCallback(() => {
    if (!captureRequestRef.current) focusComposer();
  }, [focusComposer]);
  const editCapture = useCallback((item: CaptureItem) => openDetail([item.id], item.deletedAt ? "preview" : "edit"), [openDetail]);

  const refresh = useCallback(async () => {
    const nextItems = await refreshData();
    seedIfEmpty(nextItems[0]?.id ?? null);
  }, [refreshData, seedIfEmpty]);

  const {
    handleCreate,
    handleToggle,
    handleDelete,
    handleRestore,
    handlePurge,
    handlePaste,
    handleCaptured,
    handleCreateSection,
    handleDeleteSection,
  } = useItemActions({
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
  });

  const {
    handleDeleteSelected,
    restoreSelected,
    purgeSelected,
    emptyAllTrash,
    copyItem,
    copySelected,
    markSelectedDone,
    mergeSelected,
    moveSelected,
  } = useBulkActions({
    removeItems,
    applyUpdatedItems,
    prependReplacing,
    selectedIds: actionIds,
    selectedItems: actionItems,
    setSingle,
    clearSelection,
    setContextMenu,
    announce,
    notify,
  });

  const {
    requestAccessibilityAndRefresh,
    changeShortcut,
    resetAllShortcuts,
    changeKeepOpen,
    changeTrashRetention,
    changeDefaultCaptureView,
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
    focusComposer: focusQueueComposer,
    onPermissionRequiredEvent: handlePermissionRequired,
  });

  useKeyboardShortcuts({
    shortcuts: appSettings.shortcuts,
    suspended: captureRequest !== null,
    blocked: settingsOpen || contextMenu !== null,
    dismissTop,
    openSettings,
    onEdit: editCapture,
    searchRef,
    selectedId,
    selectedIds: actionIds,
    selectedItems: actionItems,
    moveBy,
    selectAll,
    copySelected,
    mergeSelected,
    markSelectedDone,
    handlePaste,
    handleDeleteSelected,
    inTrash,
    purgeSelected,
  });

  // Row handlers never change identity, so memoized rows skip re-rendering
  // when the composer, search, or selection elsewhere in the queue changes.
  const onRowSelect = useStableCallback((id: string, event: MouseEvent<HTMLElement>) =>
    selectWith(id, { toggle: shiftSelectionMode || event.shiftKey || event.metaKey || event.ctrlKey }));
  const onRowContextMenu = useStableCallback((id: string, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    if (!isSelected(id)) setSingle(id);
    setContextMenu({ kind: "queue", x: event.clientX, y: event.clientY });
  });
  const onRowToggle = useStableCallback((id: string) => void handleToggle(id));
  const onRowSelectionControl = useStableCallback((id: string) => selectWith(id, { toggle: true }));
  const onRowEdit = useStableCallback((id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (item) editCapture(item);
  });
  const onRowPreview = useStableCallback((id: string) => openDetail([id], "preview"));
  const onRowDelete = useStableCallback((id: string) => void handleDelete(id));
  const onRowCopy = useStableCallback((id: string) => copyItem(id));
  const onRowPaste = useStableCallback((id: string) => void handlePaste(id));
  const onRowRestore = useStableCallback((id: string) => void handleRestore(id));
  const onRowPurge = useStableCallback((id: string) => void handlePurge(id));

  const sectionMenu =
    contextMenu?.kind === "section"
      ? sections.find((section) => section.id === contextMenu.sectionId) ?? null
      : null;
  const sectionMenuCaptureCount = sectionMenu
    ? items.filter((item) => item.sectionId === sectionMenu.id && item.deletedAt === null).length
    : 0;

  const emptyState = query
    ? { title: "Nothing matches that search.", hint: "Try a different word or filter." }
    : inTrash
      ? { title: "Trash is empty.", hint: appSettings.trashRetention === "immediate" ? "Deleted captures are removed right away." : `Deleted captures stay here for ${appSettings.trashRetention === "7d" ? "7" : "28"} days, then disappear.` }
      : filter === "done"
        ? { title: "Nothing marked done yet.", hint: "Press Space on a capture to mark it done." }
        : { title: "Your queue is clear.", hint: `Select anything, press ${shortcutLabel(appSettings.shortcuts.capture)}, and keep moving.` };

  return (
    <main
      className="app-frame"
      onMouseDown={() => contextMenu && setContextMenu(null)}
    >
      <section className="captura-panel" aria-label="Captura queue">
        <div className="queue-view" inert={captureRequest !== null}>
        <QueueHeader
          query={query}
          onQueryChange={setQuery}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => void hideMainWindow()}
          searchRef={searchRef}
          searchShortcut={appSettings.shortcuts.search}
          closeShortcut={appSettings.shortcuts.close}
        />

        {storageWarning ? <p className="storage-warning" role="alert">{storageWarning}</p> : null}

        {permissionExperience === "welcome" && permissions ? (
          <WelcomeSetup
            permissions={permissions}
            captureShortcut={appSettings.shortcuts.capture}
            onOpenAccessibility={requestAccessibilityAndRefresh}
            onStart={completeSetup}
            onContinueLimited={continueInLimitedMode}
          />
        ) : null}

        {permissionExperience === "repair" ||
        permissionExperience === "limited" ||
        permissionExperience === "shortcutConflict" ? (
          <PermissionBanner
            experience={permissionExperience}
            onOpenAccessibility={requestAccessibilityAndRefresh}
            onCheckAgain={refreshPermissions}
            onOpenShortcutSettings={openSettings}
          />
        ) : null}

        <QuickCapture
          content={composer}
          kind={composerKind}
          onContentChange={setComposer}
          onKindChange={setComposerKind}
          onSubmit={handleCreate}
          composerRef={composerRef}
          saving={saving}
          saveShortcut={appSettings.shortcuts.save}
          importingImages={imageImport.busy}
          imageMenuOpen={contextMenu?.kind === "image"}
          onAddImage={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            event.currentTarget.focus({ preventScroll: true });
            setContextMenu({ kind: "image", x: bounds.left, y: bounds.bottom + 5 });
          }}
        />

        <ImageImportFeedback busy={imageImport.busy} result={imageImport.result} onDismiss={imageImport.dismissResult} />

        <FilterTabs active={filter} counts={counts} onChange={setFilter} />
        {inTrash ? (
          <div className="trash-strip" role="region" aria-label="Trash">
            <span className="trash-strip-copy">
              <Trash2 size={12} />
              <strong>{counts.trash} in Trash</strong>
              <small>{trashRetentionLabel[appSettings.trashRetention]}</small>
            </span>
            {confirmingEmptyTrash ? (
              <span className="trash-strip-confirm">
                <Button variant="ghost" size="sm" onClick={() => setConfirmingEmptyTrash(false)}>Cancel</Button>
                <Button variant="danger" size="sm" onClick={() => { setConfirmingEmptyTrash(false); void emptyAllTrash(); }}>Delete all</Button>
              </span>
            ) : (
              <span className="trash-strip-actions">
                <button type="button" className="trash-strip-link" onClick={() => setSettingsOpen(true)}>Change</button>
                <Button variant="ghost" size="sm" disabled={!counts.trash} onClick={() => setConfirmingEmptyTrash(true)}>Empty trash</Button>
              </span>
            )}
          </div>
        ) : (
          <SectionBar
            sections={sections}
            active={sectionFilter}
            onChange={setSectionFilter}
            onCreate={handleCreateSection}
            onContextMenu={(section, event) => {
              event.currentTarget.focus({ preventScroll: true });
              setContextMenu({
                kind: "section",
                x: event.clientX,
                y: event.clientY,
                sectionId: section.id,
                confirmingDelete: false,
              });
            }}
          />
        )}

        <section
          ref={queueRef}
          className="queue-list"
          role="listbox"
          aria-label={inTrash ? "Trashed captures" : "Captured items"}
          aria-multiselectable="true"
          data-selection-mode={shiftSelectionMode}
          data-trash={inTrash}
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
                selected={item.id === selectedId && !shiftSelectionMode}
                multiSelected={selectedIdSet.has(item.id)}
                selectionMode={shiftSelectionMode}
                sectionName={
                  item.sectionId ? sectionNames.get(item.sectionId) : undefined
                }
                thumbnailFailed={failedThumbnails.has(item.id)}
                pasteShortcut={appSettings.shortcuts.paste}
                onSelect={onRowSelect}
                onContextMenu={onRowContextMenu}
                onToggle={onRowToggle}
                onSelectionControl={onRowSelectionControl}
                onEdit={onRowEdit}
                onPreview={onRowPreview}
                onDelete={onRowDelete}
                onCopy={onRowCopy}
                onPaste={onRowPaste}
                onRestore={onRowRestore}
                onPurge={onRowPurge}
              />
            ))
          ) : (
            <div className="empty-state" data-filter={filter}>
              <span>
                {inTrash ? <Trash2 size={20} strokeWidth={1.6} /> : <Inbox size={20} strokeWidth={1.6} />}
              </span>
              <strong>{emptyState.title}</strong>
              <p>{emptyState.hint}</p>
            </div>
          )}
        </section>

        <footer
          className="shortcut-strip"
          data-selection-mode={shiftSelectionMode}
        >
          {shiftSelectionMode ? (
            <span className="selection-mode-status" role="status">
              <ListChecks size={12} />
              <strong>Selection mode</strong>
              <small>click items individually</small>
            </span>
          ) : selectedIds.length > 1 ? (
            <span className="selection-mode-status" role="status">
              <ListChecks size={12} />
              <strong>{selectedIds.length} selected</strong>
              <small>Esc to clear</small>
            </span>
          ) : inTrash ? (
            <>
              <span>
                <Kbd>{shortcutLabel(appSettings.shortcuts.delete)}</Kbd>
                delete now
              </span>
              <i />
              <span>
                <Kbd>{shortcutLabel(appSettings.shortcuts.selectAll)}</Kbd>
                select all
              </span>
            </>
          ) : (
            <>
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
            </>
          )}
        </footer>
        </div>
        {captureRequest ? <Suspense fallback={<div className="sheet-backdrop capture-backdrop" role="status">Loading capture…</div>}>
          <CaptureSheet request={captureRequest} shortcuts={appSettings.shortcuts} defaultView={appSettings.defaultCaptureView} onDefaultViewChange={changeDefaultCaptureView} onRestore={handleRestore} onClose={closeDetail} />
        </Suspense> : null}
      </section>

      {contextMenu?.kind === "image" ? <ImageImportMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} onChoose={() => { setContextMenu(null); void imageImport.chooseImages(); }} onPaste={() => { setContextMenu(null); void imageImport.pasteImage(); }} /> : null}

      {contextMenu?.kind === "queue" ? (
        <QueueContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={actionItems}
          sections={sections}
          shortcuts={appSettings.shortcuts}
          inTrash={inTrash}
          onCopy={() => void copySelected(false)}
          onCopyAsList={() => void copySelected(true)}
          onPaste={() => {
            if (actionItems[0]) void handlePaste(actionItems[0].id);
            setContextMenu(null);
          }}
          onDone={() => void markSelectedDone()}
          onExpand={() => {
            openDetail(actionItems.map((item) => item.id), "preview");
            setContextMenu(null);
          }}
          onEdit={() => {
            if (actionItems[0]) editCapture(actionItems[0]);
            setContextMenu(null);
          }}
          onMerge={() => void mergeSelected()}
          onMove={(sectionId) => void moveSelected(sectionId)}
          onDelete={() => void handleDeleteSelected()}
          onRestore={() => void restoreSelected()}
          onPurge={() => void purgeSelected()}
          onSelectAll={() => { selectAll(); setContextMenu(null); }}
        />
      ) : null}

      {contextMenu?.kind === "section" && sectionMenu ? (
        <SectionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          name={sectionMenu.name}
          count={sectionMenuCaptureCount}
          confirmingDelete={contextMenu.confirmingDelete}
          onAskDelete={() =>
            setContextMenu((current) =>
              current?.kind === "section"
                ? { ...current, confirmingDelete: true }
                : current,
            )
          }
          onCancel={() => setContextMenu(null)}
          onDelete={() => void handleDeleteSection(sectionMenu.id)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsSheet
          permissions={permissions}
          settings={appSettings}
          trashCount={counts.trash}
          onClose={() => setSettingsOpen(false)}
          onRequestAccessibility={requestAccessibilityAndRefresh}
          onShortcutChange={changeShortcut}
          onResetShortcuts={resetAllShortcuts}
          onKeepOpenChange={changeKeepOpen}
          onTrashRetentionChange={changeTrashRetention}
          onDefaultCaptureViewChange={changeDefaultCaptureView}
          onEmptyTrash={emptyAllTrash}
          onCaptureClipboard={captureClipboard}
          onQuit={quitApp}
          updateStatus={updateStatus}
          onCheckUpdates={() => checkForUpdates(false)}
          onInstallUpdate={installUpdate}
        />
      ) : null}

      {toast ? (
        <div className="app-toast" data-tone={toast.tone} data-actionable={Boolean(toast.action)} role="status">
          <span>{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => { const { action } = toast; dismissToast(); void action?.run(); }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </main>
  );
}
