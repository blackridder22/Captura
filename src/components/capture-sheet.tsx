import { ChevronLeft, ChevronRight, Code2, Copy, Eye, FileText, Link2, Pencil, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useCaptureDetail } from "../hooks/use-capture-detail";
import { attachmentUrl, copyItems } from "../lib/api";
import { matchesShortcut } from "../lib/shortcuts";
import type { CaptureDetailRequest, CaptureView, KeyboardShortcutSettings } from "../types";
import { MarkdownText } from "./markdown-text";
import { Button } from "./ui/button";

type CaptureSheetProps = {
  request: CaptureDetailRequest;
  shortcuts: KeyboardShortcutSettings;
  defaultView?: CaptureView;
  onDefaultViewChange?: (view: CaptureView) => Promise<void>;
  onRestore?: (id: string) => Promise<void>;
  onClose: () => void;
};

const kinds = [
  { value: "prompt", label: "Prompt", icon: Sparkles },
  { value: "note", label: "Note", icon: FileText },
  { value: "link", label: "Link", icon: Link2 },
] as const;

export default function CaptureSheet({ request, shortcuts, onClose }: CaptureSheetProps) {
  const detail = useCaptureDetail(request, onClose);
  const sheetRef = useRef<HTMLElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const editing = detail.mode === "edit";
  const isImage = detail.base?.kind === "image";
  const showSource = editing && (isImage || detail.tab === "source");
  const activeId = detail.base?.id;

  useEffect(() => {
    if (detail.saving) return;
    const target = detail.pending
      ? confirmationRef.current?.querySelector<HTMLButtonElement>("button")
      : (sheetRef.current?.querySelector<HTMLElement>(showSource ? "textarea" : "[data-capture-preview]") ?? sheetRef.current?.querySelector<HTMLElement>("[aria-label='Close capture']"));
    target?.focus({ preventScroll: true });
  }, [activeId, showSource, detail.pending, detail.saving]);
  useEffect(() => setCopyMessage(""), [activeId, editing]);

  const copy = async () => {
    if (!detail.base || detail.unavailable) return;
    try {
      await copyItems([detail.base.id], "native");
      setCopyMessage(isImage ? "Image copied" : "Markdown copied");
    } catch (error) { setCopyMessage(String(error)); }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The panel owns these keys; queue actions must not run behind the overlay.
    event.stopPropagation();
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (matchesShortcut(event.nativeEvent, shortcuts.dismiss) || matchesShortcut(event.nativeEvent, shortcuts.close)) {
      event.preventDefault();
      if (detail.pending) detail.cancelPending();
      else detail.close();
      return;
    }
    if (event.key === "Tab") {
      const scope = detail.pending ? confirmationRef.current : sheetRef.current;
      const controls = [...(scope?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']") ?? [])];
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
      }
      return;
    }
    if (detail.pending) return;
    if (editing && matchesShortcut(event.nativeEvent, shortcuts.save)) {
      event.preventDefault();
      void detail.save();
      return;
    }
    if ((event.target as Element).closest("input, textarea, button, a[href], [role='button'], [contenteditable='true']")) return;
    if (!editing && matchesShortcut(event.nativeEvent, shortcuts.edit) && !detail.unavailable) {
      event.preventDefault(); detail.edit();
    } else if (!editing && matchesShortcut(event.nativeEvent, shortcuts.copy) && !window.getSelection()?.toString()) {
      event.preventDefault(); void copy();
    }
  };

  return (
    <div className="sheet-backdrop capture-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !detail.pending) detail.close(); }} onKeyDown={onKeyDown}>
      <section ref={sheetRef} className={`capture-sheet ${editing ? "edit-sheet" : "preview-sheet"}`} role="dialog" aria-modal="true" aria-labelledby="capture-sheet-title" data-mode={detail.mode} inert={Boolean(detail.pending)}>
        <header>
          <div>
            <span>{isImage ? "Image" : detail.kind === "prompt" ? "Prompt" : detail.kind === "link" ? "Link" : "Note"}</span>
            <strong id="capture-sheet-title">{editing ? (isImage ? "Edit image caption" : "Edit capture") : "Capture preview"}</strong>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close capture" onClick={detail.close}><X size={16} /></Button>
        </header>

        {detail.ids.length > 1 ? <nav className="capture-navigation" aria-label="Selected captures">
          <Button variant="ghost" size="icon" aria-label="Previous capture" disabled={detail.index === 0 || detail.loading || detail.saving} onClick={() => detail.navigate(detail.index - 1)}><ChevronLeft size={15} /></Button>
          <span aria-live="polite">{detail.index + 1} of {detail.ids.length}</span>
          <Button variant="ghost" size="icon" aria-label="Next capture" disabled={detail.index === detail.ids.length - 1 || detail.loading || detail.saving} onClick={() => detail.navigate(detail.index + 1)}><ChevronRight size={15} /></Button>
        </nav> : null}

        {editing && !isImage && detail.base ? <div className="edit-mode-switcher" role="tablist" aria-label="Edit mode">
          <button type="button" role="tab" aria-selected={detail.tab === "preview"} data-active={detail.tab === "preview"} onClick={() => detail.setTab("preview")}><Eye size={12} />Preview</button>
          <button type="button" role="tab" aria-selected={detail.tab === "source"} data-active={detail.tab === "source"} onClick={() => detail.setTab("source")}><Code2 size={12} />Source</button>
        </div> : null}

        {detail.error ? <div className="capture-notice" role="alert">{detail.error}</div> : null}
        {detail.unavailable ? <div className="capture-notice" role="status">This capture is no longer available.{detail.dirty ? " Your unsaved draft is still here." : ""}</div> : null}
        {detail.conflicted && !detail.error ? <div className="capture-notice" role="status">This capture changed elsewhere. Your draft is kept; cancel editing to load the saved version.</div> : null}

        <div className="capture-sheet-content" aria-busy={detail.loading}>
          {!detail.base ? <div className="capture-empty">{detail.loading ? "Loading capture…" : "Capture unavailable"}</div> : showSource ? (
            <textarea aria-label={isImage ? "Image caption" : "Markdown source"} readOnly={detail.saving || detail.loading} value={detail.content} onChange={(event) => detail.setContent(event.target.value)} spellCheck={false} />
          ) : (
            <article className={editing ? "edit-rendered-surface" : "capture-rendered"} data-capture-preview aria-label="Rendered Markdown preview" tabIndex={0}>
              {isImage && detail.base.attachmentPath ? <img className="preview-image" src={attachmentUrl(detail.base.attachmentPath)} alt={detail.content} draggable={false} /> : null}
              <MarkdownText content={detail.content} />
            </article>
          )}
        </div>

        <footer>
          {editing ? <>
            {isImage ? <span className="capture-status">Image caption</span> : <div className="sheet-kind-switcher" aria-label="Capture kind">
              {kinds.map(({ value, label, icon: Icon }) => <button type="button" key={value} disabled={detail.saving || detail.loading} data-active={detail.kind === value} aria-pressed={detail.kind === value} onClick={() => detail.setKind(value)}><Icon size={13} />{label}</button>)}
            </div>}
            <div className="capture-save-row">
              <span className="capture-status" role="status">{detail.dirty ? "Unsaved changes" : ""}</span>
              <Button variant="ghost" size="sm" disabled={detail.saving} onClick={detail.cancelEdit}>Cancel</Button>
              <Button variant="accent" size="sm" disabled={!detail.content.trim() || !detail.dirty || detail.saving || detail.unavailable || detail.loading} onClick={() => void detail.save()}>{detail.saving ? "Saving…" : "Save changes"}</Button>
            </div>
          </> : <>
            <span className="capture-status" role="status">{copyMessage}</span>
            <Button variant="ghost" size="sm" disabled={!detail.base || detail.unavailable} onClick={() => void copy()}><Copy size={13} />Copy</Button>
            <Button variant="surface" size="sm" disabled={!detail.base || detail.unavailable} onClick={detail.edit}><Pencil size={13} />Edit</Button>
          </>}
        </footer>
      </section>

      {detail.pending ? <div className="capture-confirmation-backdrop"><div ref={confirmationRef} className="capture-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="capture-unsaved-title" aria-describedby="capture-unsaved-description">
        <strong id="capture-unsaved-title">Save changes to this capture?</strong>
        <p id="capture-unsaved-description">Your draft has unsaved changes.</p>
        {detail.error ? <p className="capture-dialog-error" role="alert">{detail.error}</p> : null}
        <div>
          <Button variant="ghost" size="sm" disabled={detail.saving} onClick={detail.cancelPending}>Cancel</Button>
          <Button variant="surface" size="sm" disabled={detail.saving} onClick={detail.discardPending}>Discard</Button>
          <Button variant="accent" size="sm" disabled={detail.saving || detail.unavailable || !detail.content.trim()} onClick={() => void detail.save(true)}>{detail.saving ? "Saving…" : "Save"}</Button>
        </div>
      </div></div> : null}
    </div>
  );
}
