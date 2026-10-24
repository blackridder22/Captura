import {
  CheckCircle2,
  FileText,
  Inbox,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRef } from "react";
import { indicatorStyle, useSlidingIndicator } from "../hooks/use-sliding-indicator";
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

/// The active underline is one element that slides between tabs. It measures
/// the active tab, so it follows resizes and count widths.
export function FilterTabs({
  active,
  counts,
  onChange,
}: FilterTabsProps) {
  const nav = useRef<HTMLElement>(null);
  const indicator = useSlidingIndicator(nav, active, [counts]);

  return (
    <nav ref={nav} className="filter-tabs" aria-label="Capture filters">
      {filters.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          data-filter={value}
          data-indicator-key={value}
          data-active={active === value}
          onClick={() => onChange(value)}
          aria-current={active === value ? "page" : undefined}
        >
          <Icon size={15} strokeWidth={1.8} />
          <span>{label}</span>
          <small>{counts[value]}</small>
        </button>
      ))}
      {/* Trash sits apart from the live filters: icon only, count when active or non-empty. */}
      <button
        type="button"
        className="filter-trash"
        data-filter="trash"
        data-indicator-key="trash"
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
      <span
        className="filter-indicator"
        aria-hidden="true"
        data-ready={indicator.ready}
        style={indicatorStyle(indicator, 2)}
      />
    </nav>
  );
}
