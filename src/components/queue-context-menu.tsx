import {
  CheckCircle2,
  ClipboardCopy,
  Copy,
  FilePenLine,
  FolderInput,
  Maximize2,
  Merge,
  Trash2,
} from "lucide-react";
import type {
  CaptureItem,
  KeyboardShortcutSettings,
  Section,
} from "../types";
import { shortcutLabel } from "../lib/shortcuts";
import { Kbd } from "./ui/kbd";

type QueueContextMenuProps = {
  x: number;
  y: number;
  items: CaptureItem[];
  sections: Section[];
  shortcuts: KeyboardShortcutSettings;
  onCopy: () => void;
  onCopyAsList: () => void;
  onPaste: () => void;
  onDone: () => void;
  onExpand: () => void;
  onEdit: () => void;
  onMerge: () => void;
  onMove: (sectionId: string | null) => void;
  onDelete: () => void;
};

export function QueueContextMenu({
  x,
  y,
  items,
  sections,
  shortcuts,
  onCopy,
  onCopyAsList,
  onPaste,
  onDone,
  onExpand,
  onEdit,
  onMerge,
  onMove,
  onDelete,
}: QueueContextMenuProps) {
  const count = items.length;
  const single = count === 1 ? items[0] : null;
  const allText = items.every((item) => item.kind !== "image");
  const markdownUnavailable = allText
    ? undefined
    : "Markdown actions are unavailable when the selection includes an image.";

  return (
    <div
      className="queue-context-menu"
      style={{ left: Math.min(x, 84), top: Math.min(y, 260) }}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        role="menuitem"
        onClick={onCopy}
        disabled={!allText && single?.kind !== "image"}
        aria-label={
          markdownUnavailable && !single
            ? `Copy as Markdown. ${markdownUnavailable}`
            : undefined
        }
        title={markdownUnavailable && !single ? markdownUnavailable : undefined}
      >
        <Copy size={14} />
        {single?.kind === "image" ? "Copy Image" : "Copy as Markdown"}
        <Kbd>{shortcutLabel(shortcuts.copy)}</Kbd>
      </button>
      <button
        role="menuitem"
        onClick={onCopyAsList}
        disabled={!allText}
        aria-label={
          markdownUnavailable
            ? `Copy as List. ${markdownUnavailable}`
            : undefined
        }
        title={markdownUnavailable}
      >
        <ClipboardCopy size={14} />
        Copy as List
        <Kbd>{shortcutLabel(shortcuts.copyAsList)}</Kbd>
      </button>
      {single ? (
        <button role="menuitem" onClick={onPaste}>
          <ClipboardCopy size={14} />
          {single.kind === "image" ? "Paste Image" : "Paste Markdown"}
          <Kbd>{shortcutLabel(shortcuts.paste)}</Kbd>
        </button>
      ) : null}
      <i />
      <button role="menuitem" onClick={onDone}>
        <CheckCircle2 size={14} />
        Mark as Done
        <Kbd>{shortcutLabel(shortcuts.markDone)}</Kbd>
      </button>
      <button role="menuitem" onClick={onExpand}>
        <Maximize2 size={14} />
        Expand
      </button>
      <button role="menuitem" onClick={onEdit} disabled={count !== 1}>
        <FilePenLine size={14} />
        Edit
        <Kbd>{shortcutLabel(shortcuts.edit)}</Kbd>
      </button>
      <button role="menuitem" onClick={onMerge} disabled={count < 2}>
        <Merge size={14} />
        Merge Notes
        <Kbd>{shortcutLabel(shortcuts.merge)}</Kbd>
      </button>
      <div className="context-submenu">
        <span>
          <FolderInput size={14} />
          Move to
        </span>
        <div>
          <button onClick={() => onMove(null)}>Unfiled</button>
          {sections.map((section) => (
            <button key={section.id} onClick={() => onMove(section.id)}>
              {section.name}
            </button>
          ))}
        </div>
      </div>
      <i />
      <button className="context-danger" role="menuitem" onClick={onDelete}>
        <Trash2 size={14} />
        Delete
        <Kbd>{shortcutLabel(shortcuts.delete)}</Kbd>
      </button>
    </div>
  );
}
