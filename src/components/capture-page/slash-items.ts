import type { Editor, Range } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  Type,
} from "lucide-react";

export type SlashItem = {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
};

const block = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

/// The Notion-style block palette. Every command maps onto Markdown the
/// capture can round-trip; tables and HTML stay Source-only on purpose.
export const slashItems: SlashItem[] = [
  { id: "text", title: "Text", description: "Plain paragraph", keywords: ["paragraph", "p", "body"], icon: Type,
    run: (editor, range) => block(editor, range).setParagraph().run() },
  { id: "h1", title: "Heading 1", description: "Large section title", keywords: ["h1", "title", "#"], icon: Heading1,
    run: (editor, range) => block(editor, range).setHeading({ level: 1 }).run() },
  { id: "h2", title: "Heading 2", description: "Section heading", keywords: ["h2", "##"], icon: Heading2,
    run: (editor, range) => block(editor, range).setHeading({ level: 2 }).run() },
  { id: "h3", title: "Heading 3", description: "Small heading", keywords: ["h3", "###"], icon: Heading3,
    run: (editor, range) => block(editor, range).setHeading({ level: 3 }).run() },
  { id: "bullet", title: "Bulleted list", description: "Simple list", keywords: ["ul", "bullet", "-", "list"], icon: List,
    run: (editor, range) => block(editor, range).toggleBulletList().run() },
  { id: "numbered", title: "Numbered list", description: "Ordered steps", keywords: ["ol", "ordered", "1.", "list"], icon: ListOrdered,
    run: (editor, range) => block(editor, range).toggleOrderedList().run() },
  { id: "todo", title: "To-do list", description: "Checkboxes", keywords: ["task", "todo", "checkbox", "[]"], icon: CheckSquare,
    run: (editor, range) => block(editor, range).toggleTaskList().run() },
  { id: "quote", title: "Quote", description: "Pull a line out", keywords: ["blockquote", ">", "cite"], icon: Quote,
    run: (editor, range) => block(editor, range).toggleBlockquote().run() },
  { id: "code", title: "Code block", description: "Preformatted text", keywords: ["code", "```", "pre", "snippet"], icon: Code2,
    run: (editor, range) => block(editor, range).toggleCodeBlock().run() },
  { id: "divider", title: "Divider", description: "Horizontal rule", keywords: ["hr", "---", "rule", "separator"], icon: Minus,
    run: (editor, range) => block(editor, range).setHorizontalRule().run() },
];

/// Title prefixes rank first, then keyword prefixes, then title substrings.
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return items;
  const scored = items.flatMap((item) => {
    const title = item.title.toLocaleLowerCase();
    if (title.startsWith(needle)) return [{ item, score: 0 }];
    if (item.keywords.some((keyword) => keyword.startsWith(needle))) return [{ item, score: 1 }];
    if (title.includes(needle)) return [{ item, score: 2 }];
    return [];
  });
  return scored.sort((a, b) => a.score - b.score).map(({ item }) => item);
}
