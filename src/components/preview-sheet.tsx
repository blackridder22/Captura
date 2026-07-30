import { Pencil, X } from "lucide-react";
import type { CaptureItem } from "../types";
import { MarkdownText } from "./markdown-text";
import { Button } from "./ui/button";

type PreviewSheetProps = {
  items: CaptureItem[];
  onClose: () => void;
  onEdit: (() => void) | null;
};

export function PreviewSheet({ items, onClose, onEdit }: PreviewSheetProps) {
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section
        className="preview-sheet"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{items.length > 1 ? `${items.length} captures` : "Capture"}</span>
            <strong>Expanded view</strong>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close expanded view"
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </header>
        <div className="preview-content">
          {items.map((item) => (
            <article key={item.id}>
              <MarkdownText content={item.content} />
            </article>
          ))}
        </div>
        {onEdit ? (
          <footer>
            <Button variant="surface" size="sm" onClick={onEdit}>
              <Pencil size={13} />
              Edit
            </Button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
