import { ChevronLeft, ChevronRight, Code2, Copy, Eye, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCaptureDetail } from "../hooks/use-capture-detail";
import { attachmentUrl, copyItems, getAppSettings } from "../lib/api";
import { defaultShortcuts, matchesShortcut } from "../lib/shortcuts";
import type { ItemKind } from "../types";
import { MarkdownText } from "./markdown-text";
import { Button } from "./ui/button";

export default function CaptureDetail() {
  const detail = useCaptureDetail();
  const [wide, setWide] = useState(window.innerWidth >= 720);
  const [debounced, setDebounced] = useState({ id: "", content: "" });
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const [copyMessage, setCopyMessage] = useState("");
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const activeId = detail.ids[detail.index] ?? "";
  const editing = detail.mode === "edit";
  const isImage = detail.base?.kind === "image";
  const showSource = editing ? wide || detail.tab === "source" : detail.tab === "source";
  const showPreview = editing ? wide || detail.tab === "preview" : detail.tab === "preview";
  const previewContent = editing && debounced.id === activeId ? debounced.content : detail.content;

  useEffect(() => {
    const resize = () => setWide(window.innerWidth >= 720);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    let disposed = false;
    void getAppSettings().then((settings) => { if (!disposed) setShortcuts(settings.shortcuts); }).catch(() => {});
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!activeId) { setDebounced({ id: "", content: "" }); return; }
    const timeout = window.setTimeout(() => setDebounced({ id: activeId, content: detail.content }), 150);
    return () => window.clearTimeout(timeout);
  }, [activeId, detail.content]);
  useEffect(() => { if (editing && showSource && !detail.pending) sourceRef.current?.focus(); }, [activeId, editing, showSource, detail.pending]);
  useEffect(() => { if (detail.pending) confirmationRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [detail.pending]);
  useEffect(() => setCopyMessage(""), [activeId, editing]);

  const copy = async () => {
    if (!detail.base || detail.unavailable) return;
    try {
      await copyItems([detail.base.id], "native");
      setCopyMessage(isImage ? "Image copied" : "Markdown copied");
    } catch (error) { setCopyMessage(String(error)); }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (matchesShortcut(event, shortcuts.dismiss)) {
        event.preventDefault();
        if (detail.pending) detail.cancelPending();
        else detail.close();
        return;
      }
      if (detail.pending) return;
      if (matchesShortcut(event, shortcuts.close)) { event.preventDefault(); detail.close(); return; }
      if (editing && matchesShortcut(event, shortcuts.save)) { event.preventDefault(); void detail.save(); return; }
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
      if (!editing && matchesShortcut(event, shortcuts.edit) && !detail.unavailable) { event.preventDefault(); detail.edit(); return; }
      if (!editing && matchesShortcut(event, shortcuts.copy) && !window.getSelection()?.toString()) { event.preventDefault(); void copy(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  return (
    <main className="capture-detail" aria-label="Capture reader" data-mode={detail.mode} data-tab={detail.tab} data-loading={detail.loading}>
      <header className="detail-header">
        <div className="detail-heading">
          <span>Captura</span>
          <strong>{editing ? (isImage ? "Edit image caption" : "Edit capture") : "Capture preview"}</strong>
        </div>
        <div className="detail-header-actions">
          {detail.ids.length > 1 ? (
            <nav className="detail-navigation" aria-label="Selected captures">
              <Button variant="ghost" size="icon" aria-label="Previous capture" disabled={detail.index === 0 || detail.loading || detail.saving} onClick={() => detail.navigate(detail.index - 1)}><ChevronLeft size={16} /></Button>
              <span aria-live="polite">{detail.index + 1} of {detail.ids.length}</span>
              <Button variant="ghost" size="icon" aria-label="Next capture" disabled={detail.index === detail.ids.length - 1 || detail.loading || detail.saving} onClick={() => detail.navigate(detail.index + 1)}><ChevronRight size={16} /></Button>
            </nav>
          ) : null}
          {!editing && detail.base ? <Button variant="ghost" size="sm" disabled={detail.unavailable || detail.loading} onClick={() => void copy()}><Copy size={13} />Copy</Button> : null}
          {!editing && detail.base ? <Button variant="surface" size="sm" disabled={detail.unavailable || detail.loading} onClick={detail.edit}><Pencil size={13} />Edit</Button> : null}
          <Button variant="ghost" size="icon" aria-label="Close capture" onClick={detail.close}><X size={16} /></Button>
        </div>
      </header>

      <div className="detail-toolbar">
        <span className="detail-capture-kind">{detail.kind === "image" ? "Image" : detail.kind === "prompt" ? "Prompt" : detail.kind === "link" ? "Link" : "Note"}{detail.dirty ? " · Unsaved changes" : ""}</span>
        {(!editing || !wide) && detail.base ? (
          <div className="edit-mode-switcher" role="tablist" aria-label={editing ? "Edit mode" : "Read mode"}>
            <button role="tab" aria-selected={detail.tab === "preview"} data-active={detail.tab === "preview"} onClick={() => detail.setTab("preview")}><Eye size={12} />Preview</button>
            <button role="tab" aria-selected={detail.tab === "source"} data-active={detail.tab === "source"} onClick={() => detail.setTab("source")}><Code2 size={12} />{isImage ? "Caption" : "Source"}</button>
          </div>
        ) : editing ? <span className="detail-preview-hint">Source and preview</span> : null}
      </div>

      {detail.error ? <div className="detail-notice" role="alert">{detail.error}</div> : null}
      {detail.unavailable ? <div className="detail-notice" role="status">This capture is no longer available.{detail.dirty ? " Your unsaved draft is still here." : ""}</div> : null}
      {detail.conflicted && !detail.error ? <div className="detail-notice" role="status">This capture changed elsewhere. Your draft is kept; cancel editing to load the saved version.</div> : null}

      <section className="detail-content" data-split={editing && wide} aria-busy={detail.loading}>
        {!detail.base ? <div className="detail-empty">{detail.loading ? "Loading capture…" : detail.unavailable ? "Capture unavailable" : "Open a capture from the queue."}</div> : (
          <>
            {showSource ? (
              <div className="detail-source-pane">
                {editing && wide ? <span className="detail-pane-label">{isImage ? "Caption" : "Source"}</span> : null}
                <textarea ref={sourceRef} className="detail-source" data-detail-source aria-label={isImage ? "Image caption" : "Markdown source"} readOnly={!editing} disabled={detail.saving || detail.loading} value={detail.content} onChange={(event) => detail.setContent(event.target.value)} spellCheck={false} />
              </div>
            ) : null}
            {showPreview ? (
              <div className="detail-preview-pane" data-detail-preview>
                {editing && wide ? <span className="detail-pane-label">Preview</span> : null}
                <article className="detail-rendered" aria-label="Rendered capture preview" tabIndex={0}>
                  {isImage && detail.base.attachmentPath ? <img className="detail-image" src={attachmentUrl(detail.base.attachmentPath)} alt={previewContent} draggable={false} /> : null}
                  <MarkdownText content={previewContent} />
                </article>
              </div>
            ) : null}
          </>
        )}
      </section>

      <footer className="detail-footer">
        {editing ? (
          <>
            {isImage ? <span className="detail-capture-kind">Image caption</span> : <div className="sheet-kind-switcher" aria-label="Capture kind">{(["prompt", "note", "link"] as ItemKind[]).map((kind) => <button key={kind} disabled={detail.saving || detail.loading} data-active={detail.kind === kind} aria-pressed={detail.kind === kind} onClick={() => detail.setKind(kind)}>{kind[0]!.toUpperCase() + kind.slice(1)}</button>)}</div>}
            <div className="detail-footer-actions"><Button variant="ghost" size="sm" disabled={detail.saving} onClick={detail.cancelEdit}>Cancel</Button><Button variant="accent" size="sm" disabled={!detail.content.trim() || !detail.dirty || detail.saving || detail.unavailable || detail.loading} onClick={() => void detail.save()}>{detail.saving ? "Saving…" : "Save changes"}</Button></div>
          </>
        ) : <span role="status">{copyMessage || (detail.base?.sourceApp ?? "Saved locally")}</span>}
      </footer>

      {detail.pending ? <div className="detail-confirmation-backdrop"><div ref={confirmationRef} className="detail-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="detail-unsaved-title" aria-describedby="detail-unsaved-description" onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        event.preventDefault();
        const buttons = [...(confirmationRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }}><strong id="detail-unsaved-title">Save changes to this capture?</strong><p id="detail-unsaved-description">Your draft has unsaved changes.</p>{detail.error ? <p className="detail-dialog-error" role="alert">{detail.error}</p> : null}<div><Button variant="ghost" size="sm" disabled={detail.saving} onClick={detail.cancelPending}>Cancel</Button><Button variant="surface" size="sm" disabled={detail.saving} onClick={detail.discardPending}>Discard</Button><Button variant="accent" size="sm" disabled={detail.saving || detail.unavailable || !detail.content.trim()} onClick={() => void detail.save(true)}>{detail.saving ? "Saving…" : "Save"}</Button></div></div></div> : null}
    </main>
  );
}
