import {
  CheckCircle2,
  FileText,
  Inbox,
  Sparkles,
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
    </nav>
  );
}

