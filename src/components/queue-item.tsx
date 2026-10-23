import {
  Bot,
  FileText,
  Globe2,
  Image as ImageIcon,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { memo, useMemo, type MouseEvent } from "react";
import type { CaptureItem } from "../types";
import { attachmentUrl } from "../lib/api";
import { formatCaptureTime, markdownExcerpt } from "../lib/items";
import { shortcutLabel } from "../lib/shortcuts";
import { MarkdownText } from "./markdown-text";
import { Button } from "./ui/button";
import { CopyActionButton } from "./copy-action-button";
import { QueueStateControl } from "./queue-state-control";

/// Handlers take the capture id so the parent can pass stable references;
/// the row is memoized and re-renders only when its own props change.
type QueueItemProps = {
  item: CaptureItem;
  selected: boolean;
  multiSelected: boolean;
  selectionMode: boolean;
  sectionName?: string;
  thumbnailFailed?: boolean;
  /// True for captures created after the list settled: they slide in.
  enter?: boolean;
  pasteShortcut: string;
  onSelect: (id: string, event: MouseEvent<HTMLElement>) => void;
  onContextMenu: (id: string, event: MouseEvent<HTMLElement>) => void;
  onToggle: (id: string) => void;
  onSelectionControl: (id: string) => void;
  onEdit: (id: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => Promise<void>;
  onPaste: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
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

export const QueueItem = memo(function QueueItem({
  item,
  selected,
  multiSelected,
  selectionMode,
  sectionName,
  thumbnailFailed = false,
  enter = false,
  pasteShortcut,
  onSelect,
  onContextMenu,
  onToggle,
  onSelectionControl,
  onEdit,
  onPreview,
  onDelete,
  onCopy,
  onPaste,
  onRestore,
  onPurge,
}: QueueItemProps) {
  const done = item.status === "done";
  const trashed = item.deletedAt !== null;
  const excerpt = useMemo(() => markdownExcerpt(item.content), [item.content]);
  const id = item.id;

  return (
    <article
      className="queue-item"
      data-selected={selected}
      data-multi-selected={multiSelected}
      data-done={done}
      data-trashed={trashed}
      data-enter={enter}
      data-selection-mode={selectionMode}
      onClick={(event) => onSelect(id, event)}
      onMouseDown={(event) => {
        if (selectionMode || event.shiftKey) event.preventDefault();
      }}
      onContextMenu={(event) => onContextMenu(id, event)}
      onDoubleClick={(event) => {
        if (!selectionMode && !event.shiftKey && !(event.target as HTMLElement).closest("button, a")) onPreview(id);
      }}
      role="option"
      aria-selected={multiSelected}
    >
      <QueueStateControl
        done={done}
        selected={multiSelected}
        selectionMode={selectionMode}
        onToggleDone={() => { if (!trashed) onToggle(id); }}
        onSelect={() => onSelectionControl(id)}
      />

      <div className="item-copy">
        {item.kind === "image" && item.attachmentPath ? (
          <figure className="item-thumb" data-thumbnail-id={item.id}>
            {item.thumbnailPath ? <img
              src={attachmentUrl(item.thumbnailPath)}
              alt={item.content}
              loading="lazy"
              draggable={false}
            /> : <span className="thumbnail-placeholder" role="img" aria-label={thumbnailFailed ? "Image preview unavailable. Open capture to view the image." : "Image preview loading"}><ImageIcon size={17} strokeWidth={1.5} /></span>}
          </figure>
        ) : (
          <div className="item-markdown" data-link={item.kind === "link"}>
            <MarkdownText content={excerpt} compact />
          </div>
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
          {trashed ? (
            <>
              <i />
              <span>Deleted {formatCaptureTime(item.deletedAt!)}</span>
            </>
          ) : null}
        </div>
      </div>

      <time className="row-time" dateTime={item.createdAt}>
        {formatCaptureTime(item.createdAt)}
      </time>

      {selected && trashed ? (
        <div
          className="row-actions"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            className="danger-action"
            aria-label="Delete permanently"
            title="Delete now"
            onClick={() => onPurge(id)}
          >
            <Trash2 size={13} />
          </Button>
          <Button
            variant="accent"
            size="sm"
            className="restore-button"
            onClick={() => onRestore(id)}
          >
            <RotateCcw size={12} />
            Restore
          </Button>
        </div>
      ) : selected ? (
        <div
          className="row-actions"
          onClick={(event) => event.stopPropagation()}
        >
          <CopyActionButton kind={item.kind} onCopy={() => onCopy(id)} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit capture"
            onClick={() => onEdit(id)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="danger-action"
            aria-label="Delete capture"
            title="Move to Trash"
            onClick={() => onDelete(id)}
          >
            <Trash2 size={13} />
          </Button>
          <Button
            variant="accent"
            size="sm"
            className="paste-button"
            onClick={() => onPaste(id)}
          >
            {item.kind === "image" ? "Paste Image" : "Paste formatted"}
            <kbd>{shortcutLabel(pasteShortcut)}</kbd>
          </Button>
        </div>
      ) : null}
    </article>
  );
});
