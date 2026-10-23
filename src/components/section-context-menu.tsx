import { ArrowLeft, Trash2 } from "lucide-react";
import { useMenuFocus, useMenuPosition } from "../hooks/use-menu-position";
import type { PresenceState } from "../hooks/use-presence";

type SectionContextMenuProps = {
  x: number;
  y: number;
  name: string;
  count: number;
  confirmingDelete: boolean;
  presenceState?: PresenceState;
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
  presenceState,
  onAskDelete,
  onCancel,
  onDelete,
}: SectionContextMenuProps) {
  const { ref, position } = useMenuPosition(x, y, confirmingDelete);
  useMenuFocus(ref, confirmingDelete);

  return (
    <div
      className="section-context-menu"
      ref={ref}
      style={position}
      data-state={presenceState}
      data-confirming={confirmingDelete}
      role={confirmingDelete ? "alertdialog" : "menu"}
      aria-modal={confirmingDelete || undefined}
      aria-label={confirmingDelete ? `Delete ${name}?` : `${name} section actions`}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
        if (["ArrowDown", "ArrowUp", "Tab"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(index + (event.key === "ArrowUp" || event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }}
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
          <button className="context-danger" role="menuitem" onClick={(event) => event.shiftKey ? onDelete() : onAskDelete()}>
            <Trash2 size={14} />
            Delete section…
          </button>
        </>
      )}
    </div>
  );
}
