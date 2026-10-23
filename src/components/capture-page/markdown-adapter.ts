import type { Editor, JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { safeMarkdownUrl } from "../markdown-text";

/// Everything the page can represent round-trips to Markdown. Tables and raw
/// HTML are deliberately absent: those captures open in Source.
export function pageExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        isAllowedUri: (url) => Boolean(safeMarkdownUrl(url)),
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      },
      codeBlock: { HTMLAttributes: { spellcheck: "false" } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder, showOnlyWhenEditable: true }),
    Markdown,
  ];
}

function manager(editor: Editor) {
  const instance = editor.markdown;
  if (!instance) throw new Error("Markdown support is not loaded in this editor.");
  return instance;
}

export function parseMarkdown(editor: Editor, markdown: string): JSONContent {
  return manager(editor).parse(markdown);
}

export function serializeMarkdown(editor: Editor): string {
  return editor.getMarkdown();
}

/// Canonical spelling for comparison only: line endings, trailing spaces,
/// bullet and emphasis markers, fence style, blank-line runs. Never used to
/// rewrite a capture.
export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+$/, "")
        .replace(/\\$/, "")
        .replace(/^(\s*)[*+](\s+)/, "$1-$2")
        .replace(/^(\s*\d+)\)(\s+)/, "$1.$2")
        .replace(/^(\s*)~~~/, "$1```")
        .replace(/^(\s*- \[)[xX](\])/, "$1x$2")
        .replace(/^(\s*- \[) (\])/, "$1 $2")
        .replace(/^\s+(?=[-\d>`#*]|\S)/, (indent) => " ".repeat(Math.min(indent.length, 8))),
    )
    .join("\n")
    .replace(/__([^_\n]+)__/g, "**$1**")
    .replace(/(^|[^\w*\\])_([^_\n]+)_(?![\w])/g, "$1*$2*")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/// True when parsing and re-serializing would change the capture beyond
/// cosmetic spelling (HTML, tables, images, footnotes, setext headings …).
/// Pass the already parsed document to avoid parsing twice.
export function roundTripIsLossy(editor: Editor, source: string, parsed?: JSONContent): boolean {
  if (!source.trim()) return false;
  try {
    const serialized = manager(editor).serialize(parsed ?? parseMarkdown(editor, source));
    if (serialized === source) return false;
    return normalizeMarkdown(serialized) !== normalizeMarkdown(source);
  } catch {
    return true;
  }
}

/// Replaces the document without emitting an update, so the change never
/// counts as an edit (and never triggers a save).
export function loadMarkdown(editor: Editor, markdown: string) {
  editor.commands.setContent(parseMarkdown(editor, markdown), { emitUpdate: false });
}
