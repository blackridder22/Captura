import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useLayoutEffect, useRef } from "react";

type SourceEditorProps = {
  value: string;
  readOnly: boolean;
  placeholder?: string;
  autofocus?: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

// Colours come from the app tokens so Source matches the rest of the panel.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--text)", fontWeight: "740" },
  { tag: tags.heading1, fontSize: "1.2em" },
  { tag: tags.heading2, fontSize: "1.1em" },
  { tag: tags.strong, fontWeight: "740", color: "var(--text)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--subtle)" },
  { tag: tags.link, color: "var(--accent-strong)" },
  { tag: tags.url, color: "var(--accent-strong)", textDecoration: "underline" },
  { tag: tags.monospace, color: "var(--code)" },
  { tag: tags.quote, color: "var(--muted)" },
  { tag: tags.list, color: "var(--accent)" },
  { tag: tags.contentSeparator, color: "var(--subtle)" },
  { tag: [tags.processingInstruction, tags.meta, tags.labelName], color: "var(--subtle)" },
  { tag: tags.escape, color: "var(--subtle)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent", fontSize: "12.5px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65", overflow: "auto", padding: "4px 0" },
  ".cm-content": { padding: "8px 12px 24px", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(240, 139, 100, 0.26)",
  },
  ".cm-placeholder": { color: "var(--subtle)" },
}, { dark: true });

/// Minimal CodeMirror 6 setup: Markdown + GFM, history, list continuation,
/// line wrapping. No gutters or autocomplete; this is a note, not an IDE.
export function SourceEditor({ value, readOnly, placeholder, autofocus = false, ariaLabel, onChange, onBlur }: SourceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const latest = useRef({ onChange, onBlur, value });
  latest.current = { onChange, onBlur, value };

  useLayoutEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: latest.current.value,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(markdownHighlight),
        keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        placeholder ? cmPlaceholder(placeholder) : [],
        readOnlyCompartment.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          if (update.focusChanged && !update.view.hasFocus) latest.current.onBlur?.();
        }),
        theme,
      ],
    });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    if (autofocus) {
      instance.focus();
      instance.dispatch({ selection: { anchor: instance.state.doc.length } });
    }
    return () => { instance.destroy(); view.current = null; };
    // The editor is created once per mount; props sync through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    // External change (Page edit, remote update): replace without losing history.
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    });
  }, [readOnly]);

  return <div ref={host} className="source-editor" data-readonly={readOnly} />;
}
