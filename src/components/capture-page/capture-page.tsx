import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { ChevronLeft, ChevronRight, Code2, Copy, FileText, Link2, PanelTop, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useCaptureDetail } from "../../hooks/use-capture-detail";
import type { PresenceState } from "../../hooks/use-presence";
import { indicatorStyle, useSlidingIndicator } from "../../hooks/use-sliding-indicator";
import { attachmentUrl, copyItems } from "../../lib/api";
import { captureTitle } from "../../lib/items";
import { matchesShortcut } from "../../lib/shortcuts";
import type { CaptureDetailRequest, CaptureView, KeyboardShortcutSettings } from "../../types";
import { Button } from "../ui/button";
import { parseMarkdown, roundTripIsLossy, serializeMarkdown } from "./markdown-adapter";
import { getSharedPageEditor, PAGE_PLACEHOLDER, resetDocument, setSlashContainer } from "./page-editor-instance";
import { SourceEditor } from "./source-editor";

type CapturePageProps = {
  request: CaptureDetailRequest;
  shortcuts: KeyboardShortcutSettings;
  defaultView?: CaptureView;
  onDefaultViewChange?: (view: CaptureView) => Promise<void>;
  onRestore?: (id: string) => Promise<void>;
  presenceState?: PresenceState;
  onClose: () => void;
};

const kinds = [
  { value: "prompt", label: "Prompt", icon: Sparkles },
  { value: "note", label: "Note", icon: FileText },
  { value: "link", label: "Link", icon: Link2 },
] as const;

function saveStatus(detail: ReturnType<typeof useCaptureDetail>) {
  if (detail.trashed) return "In Trash · read only";
  if (detail.unavailable) return "No longer available";
  if (detail.saveState === "saving") return "Saving…";
  if (detail.saveState === "error") return "Not saved";
  if (detail.dirty) return "Unsaved";
  if (detail.saveState === "saved") return "Saved";
  return "";
}

/// One page per capture. The Tiptap document is the live view of the
/// Markdown; Source is the same Markdown in CodeMirror. Markdown stays the
/// record: the page never re-serializes until something is actually edited.
export default function CapturePage({ request, shortcuts, defaultView = "page", onDefaultViewChange, onRestore, presenceState, onClose }: CapturePageProps) {
  const detail = useCaptureDetail(request, onClose, defaultView);
  const sheetRef = useRef<HTMLElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const isImage = detail.base?.kind === "image";
  const readOnly = detail.trashed || detail.unavailable;
  const activeId = detail.base?.id;
  const showSource = !isImage && detail.view === "source";
  const lastEmitted = useRef<string | null>(null);
  const lossyCheckedFor = useRef<string | null>(null);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  // Footer switchers: one highlight slides between Page | Source and between
  // the kinds, like the queue's tab rows. Re-measured when a capture loads.
  const viewTabs = useRef<HTMLDivElement>(null);
  const viewIndicator = useSlidingIndicator(viewTabs, showSource ? "source" : "page", [activeId, isImage, detail.loading]);
  const kindTabs = useRef<HTMLDivElement>(null);
  const kindIndicator = useSlidingIndicator(kindTabs, String(detail.kind), [activeId, isImage, detail.loading]);

  // The editor is shared across opens (see page-editor-instance); this page
  // only attaches handlers, loads the capture, and gives it back on close.
  const editor = useMemo(() => getSharedPageEditor(), []);
  useEffect(() => {
    setSlashContainer(sheetRef.current);
    const onUpdate = ({ editor: instance, transaction }: { editor: Editor; transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      const markdown = serializeMarkdown(instance);
      lastEmitted.current = markdown;
      detailRef.current.setContent(markdown);
    };
    const onBlur = () => { void detailRef.current.flush(); };
    editor.on("update", onUpdate);
    editor.on("blur", onBlur);
    return () => {
      editor.off("update", onUpdate);
      editor.off("blur", onBlur);
      editor.setEditable(false);
      setSlashContainer(null);
    };
  }, [editor]);

  // A freshly loaded capture: parse once, decide Page vs Source from that
  // parse, load it as a fresh document (history cleared), then focus.
  useEffect(() => {
    const base = detail.base;
    if (!base || isImage) return;
    if (lossyCheckedFor.current !== base.id) {
      lossyCheckedFor.current = base.id;
      const parsed = parseMarkdown(editor, base.content);
      if (roundTripIsLossy(editor, base.content, parsed)) {
        detail.markLossy(true);
        return;
      }
      resetDocument(editor, parsed);
      lastEmitted.current = base.content;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeId, isImage]);

  useEffect(() => { editor.setEditable(!readOnly && !detail.loading && Boolean(detail.base)); }, [editor, readOnly, detail.loading, detail.base]);

  // Source edits and remote updates reach the page through `content`.
  useEffect(() => {
    if (isImage || showSource || !detail.base) return;
    if (detail.content === lastEmitted.current) return;
    resetDocument(editor, parseMarkdown(editor, detail.content));
    lastEmitted.current = detail.content;
  }, [editor, detail.content, isImage, showSource, detail.base]);

  useEffect(() => {
    if (detail.loading || !detail.base) return;
    if (detail.pending) {
      confirmationRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      return;
    }
    if (readOnly) {
      sheetRef.current?.querySelector<HTMLElement>("[data-capture-scroll]")?.focus({ preventScroll: true });
      return;
    }
    if (isImage) {
      sheetRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
      return;
    }
    if (!showSource) editor.commands.focus(detail.mode === "edit" ? "end" : "start", { scrollIntoView: false });
    // Source focuses itself on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, detail.loading, detail.pending, readOnly, isImage, showSource, editor]);
  useEffect(() => setCopyMessage(""), [activeId]);

  const copy = async () => {
    if (!detail.base || detail.unavailable) return;
    try {
      await detail.flush();
      await copyItems([detail.base.id], "native");
      setCopyMessage(isImage ? "Image copied" : "Markdown copied");
    } catch (error) { setCopyMessage(String(error)); }
  };

  const switchView = (view: CaptureView) => {
    if (view === detail.view) return;
    detail.setView(view);
    if (!detail.lossy) void onDefaultViewChange?.(view);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The page owns these keys; queue actions must not run behind the overlay.
    event.stopPropagation();
    const native = event.nativeEvent as typeof event.nativeEvent & { capturaConsumed?: boolean };
    // ProseMirror calls preventDefault on Escape and Enter for its own reasons
    // (prosemirror-view's captureKeyDown, keyed on keyCode), so defaultPrevented
    // cannot mean "another layer owns this key". Layers that do, such as the
    // slash palette, mark the event as consumed instead.
    if (native.isComposing || native.capturaConsumed) return;
    if (matchesShortcut(native, shortcuts.dismiss) || matchesShortcut(native, shortcuts.close)) {
      event.preventDefault();
      if (detail.pending) detail.cancelPending();
      else detail.close();
      return;
    }
    if (event.key === "Tab" && !event.defaultPrevented && !(event.target as Element).closest(".ProseMirror, .cm-editor")) {
      const scope = detail.pending ? confirmationRef.current : sheetRef.current;
      const controls = [...(scope?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0'], .ProseMirror, .cm-content") ?? [])];
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
      }
      return;
    }
    if (detail.pending) return;
    if (matchesShortcut(event.nativeEvent, shortcuts.save)) {
      event.preventDefault();
      detail.saveAndClose();
      return;
    }
    if ((event.target as Element).closest("input, textarea, button, a[href], [role='button'], [contenteditable='true']")) return;
    if (matchesShortcut(event.nativeEvent, shortcuts.copy) && !window.getSelection()?.toString()) {
      event.preventDefault(); void copy();
    }
  };

  const title = detail.base ? (isImage ? "Image" : captureTitle(detail.content)) : "Capture";
  const kindLabel = isImage ? "Image" : detail.kind === "prompt" ? "Prompt" : detail.kind === "link" ? "Link" : "Note";
  const status = saveStatus(detail);

  return (
    <div className="panel-page capture-page-host" data-state={presenceState} onKeyDown={onKeyDown}>
      <section ref={sheetRef} className="capture-page" role="dialog" aria-modal="true" aria-labelledby="capture-sheet-title" data-view={showSource ? "source" : "page"} data-readonly={readOnly} inert={Boolean(detail.pending)}>
        <header>
          <div>
            <span>{kindLabel}</span>
            <strong id="capture-sheet-title">{title}</strong>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close capture" title="Close (Esc)" onClick={detail.close}><X size={16} /></Button>
        </header>

        {detail.ids.length > 1 ? <nav className="capture-navigation" aria-label="Selected captures">
          <Button variant="ghost" size="icon" aria-label="Previous capture" disabled={detail.index === 0 || detail.loading || detail.saving} onClick={() => detail.navigate(detail.index - 1)}><ChevronLeft size={15} /></Button>
          <span aria-live="polite">{detail.index + 1} of {detail.ids.length}</span>
          <Button variant="ghost" size="icon" aria-label="Next capture" disabled={detail.index === detail.ids.length - 1 || detail.loading || detail.saving} onClick={() => detail.navigate(detail.index + 1)}><ChevronRight size={15} /></Button>
        </nav> : null}

        {detail.error && !detail.pending ? <div className="capture-notice" role="alert">{detail.error}</div> : null}
        {detail.unavailable ? <div className="capture-notice" role="status">This capture is no longer available.{detail.dirty ? " Your unsaved draft is still here." : ""}</div> : null}
        {detail.trashed && detail.base ? <div className="capture-notice capture-notice-row" role="status"><span>This capture is in Trash.</span>{onRestore ? <Button variant="surface" size="sm" onClick={() => void onRestore(detail.base!.id)}><RotateCcw size={12} />Restore</Button> : null}</div> : null}
        {detail.conflicted && !detail.error ? <div className="capture-notice" role="status">This capture changed elsewhere. Your draft is kept; close to load the saved version.</div> : null}
        {detail.lossy && showSource ? <div className="capture-notice capture-notice-row" role="status"><span>Opened in Source to keep this capture's formatting.</span><Button variant="ghost" size="sm" onClick={() => detail.setView("page")}>Open as page anyway</Button></div> : null}

        <div className="capture-sheet-content" aria-busy={detail.loading}>
          {!detail.base ? <div className="capture-empty">{detail.loading ? "Loading capture…" : "Capture unavailable"}</div> : isImage ? (
            <div className="capture-scroll" data-capture-scroll tabIndex={0}>
              {detail.base.attachmentPath ? <img className="preview-image" src={attachmentUrl(detail.base.attachmentPath)} alt={detail.content} draggable={false} /> : null}
              <textarea className="caption-field" aria-label="Image caption" readOnly={readOnly} value={detail.content} onChange={(event) => detail.setContent(event.target.value)} onBlur={() => void detail.flush()} rows={2} spellCheck />
            </div>
          ) : showSource ? (
            <SourceEditor
              key={activeId}
              value={detail.content}
              readOnly={readOnly}
              autofocus={!readOnly}
              placeholder={PAGE_PLACEHOLDER}
              ariaLabel="Markdown source"
              onChange={(value) => detail.setContent(value)}
              onBlur={() => void detail.flush()}
            />
          ) : (
            <div className="capture-scroll page-scroll" data-capture-scroll tabIndex={readOnly ? 0 : -1} onMouseDown={(event) => { if (event.target === event.currentTarget && !readOnly) { event.preventDefault(); editor.commands.focus("end"); } }}>
              <EditorContent editor={editor} />
            </div>
          )}
        </div>

        <footer>
          <div className="capture-footer-row">
            {!isImage ? <div ref={viewTabs} className="view-switcher" role="tablist" aria-label="Capture view">
              <span className="nav-indicator" aria-hidden="true" data-ready={viewIndicator.ready} style={indicatorStyle(viewIndicator)} />
              <button type="button" role="tab" aria-selected={!showSource} data-active={!showSource} data-indicator-key="page" onClick={() => switchView("page")}><PanelTop size={12} />Page</button>
              <button type="button" role="tab" aria-selected={showSource} data-active={showSource} data-indicator-key="source" onClick={() => switchView("source")}><Code2 size={12} />Source</button>
            </div> : <span className="capture-status">Image caption</span>}
            <span className="capture-status capture-save-status" role="status" data-state={detail.saveState} aria-live="polite">{copyMessage || status}</span>
          </div>
          <div className="capture-footer-row">
            {!isImage ? <div ref={kindTabs} className="sheet-kind-switcher" aria-label="Capture kind">
              <span className="nav-indicator" aria-hidden="true" data-ready={kindIndicator.ready} style={indicatorStyle(kindIndicator)} />
              {kinds.map(({ value, label, icon: Icon }) => <button type="button" key={value} disabled={readOnly || detail.loading} data-active={detail.kind === value} aria-pressed={detail.kind === value} data-indicator-key={value} onClick={() => detail.setKind(value)}><Icon size={13} />{label}</button>)}
            </div> : <span />}
            <div className="capture-save-row">
              <Button variant="ghost" size="sm" disabled={!detail.base || detail.unavailable} onClick={() => void copy()}><Copy size={13} />Copy</Button>
              <Button variant="surface" size="sm" disabled={!detail.base} onClick={() => detail.saveAndClose()}>Done</Button>
            </div>
          </div>
        </footer>
      </section>

      {detail.pending ? <div className="capture-confirmation-backdrop"><div ref={confirmationRef} className="capture-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="capture-unsaved-title" aria-describedby="capture-unsaved-description">
        <strong id="capture-unsaved-title">{detail.content.trim() ? "This capture could not be saved" : "This capture is empty"}</strong>
        <p id="capture-unsaved-description">{detail.content.trim() ? "Your draft is still here. Retry, keep editing, or discard the changes." : "A capture cannot be empty. Keep editing or discard the changes."}</p>
        {detail.error ? <p className="capture-dialog-error" role="alert">{detail.error}</p> : null}
        <div>
          <Button variant="ghost" size="sm" disabled={detail.saving} onClick={detail.cancelPending}>Keep editing</Button>
          <Button variant="surface" size="sm" disabled={detail.saving} onClick={detail.discardPending}>Discard</Button>
          {detail.content.trim() ? <Button variant="accent" size="sm" disabled={detail.saving || detail.unavailable} onClick={detail.retryPending}>{detail.saving ? "Saving…" : "Retry"}</Button> : null}
        </div>
      </div></div> : null}
    </div>
  );
}
