import { Check, Circle, Plus } from "lucide-react";
import type { MouseEvent } from "react";

type QueueStateControlProps = {
  done: boolean;
  selected: boolean;
  selectionMode: boolean;
  onToggleDone: () => void;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function QueueStateControl({
  done,
  selected,
  selectionMode,
  onToggleDone,
  onSelect,
}: QueueStateControlProps) {
  return (
    <button
      type="button"
      className="queue-state-control"
      data-mode={selectionMode ? "selection" : "status"}
      data-done={done}
      data-selected={selected}
      aria-pressed={selectionMode ? selected : undefined}
      aria-label={
        selectionMode
          ? selected
            ? "Deselect capture"
            : "Select capture"
          : done
            ? "Mark capture open"
            : "Mark capture done"
      }
      onClick={(event) => {
        event.stopPropagation();
        if (selectionMode || event.shiftKey) {
          onSelect(event);
        } else {
          onToggleDone();
        }
      }}
    >
      <span className="queue-state-icon queue-state-status" aria-hidden="true">
        {done ? (
          <Check size={14} strokeWidth={2.5} />
        ) : (
          <Circle size={19} strokeWidth={1.5} />
        )}
      </span>
      <span className="queue-state-icon queue-state-selection" aria-hidden="true">
        {selected ? (
          <Check size={14} strokeWidth={2.7} />
        ) : (
          <Plus size={14} strokeWidth={2.25} />
        )}
      </span>
    </button>
  );
}
