import {
  CheckCircle2,
  FileText,
  Inbox,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { QueueFilter } from "../types";

type FilterTabsProps = {
  active: QueueFilter;
  counts: Record<QueueFilter, number>;
  onChange: (filter: QueueFilter) => void;
};

const filters = [
  { value: "inbox" as const, label: "Inbox", icon: Inbox },
  { value: "prompts" as const, label: "Prompts", icon: Sparkles },
  { value: "notes" as const, label: "Notes", icon: FileText },
  { value: "done" as const, label: "Done", icon: CheckCircle2 },
];

export function FilterTabs({
  active,
  counts,
  onChange,
}: FilterTabsProps) {
  return (
    <nav className="filter-tabs" aria-label="Capture filters">
      {filters.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          data-active={active === value}
          onClick={() => onChange(value)}
          aria-current={active === value ? "page" : undefined}
        >
          <Icon size={15} strokeWidth={1.8} />
          <span>{label}</span>
          <small>{counts[value]}</small>
        </button>
      ))}
      {/* Trash sits apart from the live filters: icon only, count on hover/active. */}
      <button
        type="button"
        className="filter-trash"
        data-active={active === "trash"}
        data-empty={counts.trash === 0}
        onClick={() => onChange("trash")}
        aria-current={active === "trash" ? "page" : undefined}
        aria-label={`Trash, ${counts.trash} capture${counts.trash === 1 ? "" : "s"}`}
        title="Trash"
      >
        <Trash2 size={15} strokeWidth={1.8} />
        <small>{counts.trash}</small>
      </button>
    </nav>
  );
}
