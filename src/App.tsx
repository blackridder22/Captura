import { ArrowDown, ArrowUp, Inbox, Keyboard, ListChecks } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { cleanupImageFiles, hideMainWindow, quitApp } from "./lib/api";
import type { CaptureDetailRequest, CaptureItem } from "./types";
import { shortcutLabel } from "./lib/shortcuts";
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
  const {
    selectedId,
    selectedIds,
    actionIds,
    actionItems,
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
    contextMenu,
    setContextMenu,
    settingsOpen,
    setSettingsOpen,
    openSettings,
    dismissTop,
  } = useOverlays();
  const {
    permissions,
    experience: permissionExperience,
    refreshPermissions,
    completeSetup,
    continueInLimitedMode,
    handlePermissionRequired,
  } = usePermissions(settingsOpen);
  const { announcement, toast, announce, notify } = useNotify();
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
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => { void cleanupImageFiles().catch((error) => console.warn("Image file cleanup failed", error)); });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [loading]);
  const shiftSelectionMode = useShiftSelectionMode();
  const searchRef = useRef<HTMLInputElement>(null);
  const [captureRequest, setCaptureRequest] = useState<CaptureDetailRequest | null>(null);
  const captureRequestRef = useRef(captureRequest);
  captureRequestRef.current = captureRequest;
  const captureOpener = useRef<HTMLElement | null>(null);
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
  const editCapture = useCallback((item: CaptureItem) => openDetail([item.id], "edit"), [openDetail]);

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
    copySelected,
    mergeSelected,
    markSelectedDone,
    handlePaste,
    handleDeleteSelected,
  });

  const sectionMenu =
    contextMenu?.kind === "section"
      ? sections.find((section) => section.id === contextMenu.sectionId) ?? null
      : null;
  const sectionMenuCaptureCount = sectionMenu
    ? items.filter((item) => item.sectionId === sectionMenu.id).length
    : 0;

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

        <section
          ref={queueRef}
          className="queue-list"
          role="listbox"
          aria-label="Captured items"
          aria-multiselectable="true"
          data-selection-mode={shiftSelectionMode}
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
                multiSelected={selectedIds.includes(item.id)}
                selectionMode={shiftSelectionMode}
                sectionName={
                  item.sectionId ? sectionNames.get(item.sectionId) : undefined
                }
                thumbnailFailed={failedThumbnails.has(item.id)}
                onSelect={(event) =>
                  selectWith(item.id, {
                    toggle:
                      shiftSelectionMode ||
                      event.shiftKey ||
                      event.metaKey ||
                      event.ctrlKey,
                  })
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!isSelected(item.id)) {
                    setSingle(item.id);
                  }
                  setContextMenu({
                    kind: "queue",
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onToggle={() => void handleToggle(item.id)}
                onSelectionControl={() =>
                  selectWith(item.id, { toggle: true })
                }
                onEdit={() => editCapture(item)}
                onPreview={() => openDetail([item.id], "preview")}
                onDelete={() => void handleDelete(item.id)}
                onCopy={() => copyItem(item.id)}
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
          <CaptureSheet request={captureRequest} shortcuts={appSettings.shortcuts} onClose={closeDetail} />
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
