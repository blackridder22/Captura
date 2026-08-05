import {
  Bot,
  FileText,
  Globe2,
  Image as ImageIcon,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { MouseEvent } from "react";
import type { CaptureItem } from "../types";
import { attachmentUrl } from "../lib/api";
import { formatCaptureTime } from "../lib/items";
import { shortcutLabel } from "../lib/shortcuts";
import { MarkdownText } from "./markdown-text";
import { Button } from "./ui/button";
import { CopyActionButton } from "./copy-action-button";
import { QueueStateControl } from "./queue-state-control";

type QueueItemProps = {
  item: CaptureItem;
  selected: boolean;
  multiSelected: boolean;
  selectionMode: boolean;
  sectionName?: string;
  onSelect: (event: MouseEvent<HTMLElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onToggle: () => void;
  onSelectionControl: (event: MouseEvent<HTMLButtonElement>) => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => Promise<void>;
  onPaste: () => void;
  pasteShortcut: string;
};

function SourceIcon({ item }: { item: CaptureItem }) {
  if (item.kind === "image") {
    return <ImageIcon size={12} strokeWidth={1.8} />;
  }
  if (item.sourceApp?.toLocaleLowerCase().includes("chatgpt")) {
    return <Bot size={12} strokeWidth={1.8} />;
  }
  if (
    item.kind === "link" ||
    item.sourceApp?.toLocaleLowerCase().includes("chrome")
  ) {
    return <Globe2 size={12} strokeWidth={1.8} />;
  }
  if (item.kind === "prompt") {
    return <Sparkles size={12} strokeWidth={1.8} />;
  }
  return <FileText size={12} strokeWidth={1.8} />;
}

export function QueueItem({
  item,
  selected,
  multiSelected,
  selectionMode,
  sectionName,
  onSelect,
  onContextMenu,
  onToggle,
  onSelectionControl,
  onEdit,
  onDelete,
  onCopy,
  onPaste,
  pasteShortcut,
}: QueueItemProps) {
  const done = item.status === "done";

  return (
    <article
      className="queue-item"
      data-selected={selected}
      data-multi-selected={multiSelected}
      data-done={done}
      data-selection-mode={selectionMode}
      onClick={onSelect}
      onMouseDown={(event) => {
        if (selectionMode || event.shiftKey) event.preventDefault();
      }}
      onContextMenu={onContextMenu}
      onDoubleClick={(event) => {
        if (!selectionMode && !event.shiftKey) onEdit();
      }}
      role="option"
      aria-selected={multiSelected}
    >
      <QueueStateControl
        done={done}
        selected={multiSelected}
        selectionMode={selectionMode}
        onToggleDone={onToggle}
        onSelect={onSelectionControl}
      />

      <div className="item-copy">
        {item.kind === "image" && item.attachmentPath ? (
          <figure className="item-thumb">
            <img
              src={attachmentUrl(item.attachmentPath)}
              alt={item.content}
              loading="lazy"
              draggable={false}
            />
          </figure>
        ) : (
          <p data-link={item.kind === "link"}>
            <MarkdownText content={item.content} compact />
          </p>
        )}
        <div className="item-meta">
          <SourceIcon item={item} />
          <span>
            {item.sourceApp ??
              (item.kind === "note"
                ? "Note"
                : item.kind === "image"
                  ? "Image"
                  : "Prompt")}
          </span>
          {sectionName ? (
            <>
              <i />
              <span>{sectionName}</span>
            </>
          ) : null}
        </div>
      </div>

      <time className="row-time" dateTime={item.createdAt}>
        {formatCaptureTime(item.createdAt)}
      </time>

      {selected ? (
        <div
          className="row-actions"
          onClick={(event) => event.stopPropagation()}
        >
          <CopyActionButton kind={item.kind} onCopy={onCopy} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit capture"
            onClick={onEdit}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="danger-action"
            aria-label="Delete capture"
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </Button>
          <Button
            variant="accent"
            size="sm"
            className="paste-button"
            onClick={onPaste}
          >
            {item.kind === "image" ? "Paste Image" : "Paste Markdown"}
            <kbd>{shortcutLabel(pasteShortcut)}</kbd>
          </Button>
        </div>
      ) : null}
    </article>
  );
}
