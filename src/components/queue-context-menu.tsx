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
import type { KeyboardShortcutSettings, Section } from "../types";
import { shortcutLabel } from "../lib/shortcuts";
import { Kbd } from "./ui/kbd";

type QueueContextMenuProps = {
  x: number;
  y: number;
  count: number;
  sections: Section[];
  shortcuts: KeyboardShortcutSettings;
  onCopy: () => void;
  onCopyAsList: () => void;
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
  count,
  sections,
  shortcuts,
  onCopy,
  onCopyAsList,
  onDone,
  onExpand,
  onEdit,
  onMerge,
  onMove,
  onDelete,
}: QueueContextMenuProps) {
  return (
    <div
      className="queue-context-menu"
      style={{ left: Math.min(x, 84), top: Math.min(y, 260) }}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button role="menuitem" onClick={onCopy}>
        <Copy size={14} />
        Copy
        <Kbd>{shortcutLabel(shortcuts.copy)}</Kbd>
      </button>
      <button role="menuitem" onClick={onCopyAsList}>
        <ClipboardCopy size={14} />
        Copy as List
        <Kbd>{shortcutLabel(shortcuts.copyAsList)}</Kbd>
      </button>
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
