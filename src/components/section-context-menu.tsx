import { ArrowLeft, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";

type SectionContextMenuProps = {
  x: number;
  y: number;
  name: string;
  count: number;
  confirmingDelete: boolean;
  onAskDelete: () => void;
  onCancel: () => void;
  onDelete: () => void;
};

export function SectionContextMenu({
  x,
  y,
  name,
  count,
  confirmingDelete,
  onAskDelete,
  onCancel,
  onDelete,
}: SectionContextMenuProps) {
  const beginDelete = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey) onDelete();
    else onAskDelete();
  };

  return (
    <div
      className="section-context-menu"
      style={{ left: Math.min(x, 196), top: Math.min(y, 472) }}
      role={confirmingDelete ? "alertdialog" : "menu"}
      aria-label={confirmingDelete ? `Delete ${name}?` : `${name} section actions`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {confirmingDelete ? (
        <div className="section-delete-confirmation">
          <strong>Delete “{name}”?</strong>
          <p>
            {count} capture{count === 1 ? "" : "s"} will move to Unfiled.
          </p>
          <div>
            <button onClick={onCancel}>
              <ArrowLeft size={13} />
              Cancel
            </button>
            <button className="context-danger" onClick={onDelete}>
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="context-danger" role="menuitem" onClick={beginDelete}>
            <Trash2 size={14} />
            Delete Section
          </button>
          <small>Shift-click Delete to skip confirmation</small>
        </>
      )}
    </div>
  );
}
