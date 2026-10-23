import {
  CheckCircle2,
  FileText,
  Inbox,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
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

/// The active underline is one element that slides between tabs (transform
/// only). It measures the active tab, so it follows resizes and count widths.
export function FilterTabs({
  active,
  counts,
  onChange,
}: FilterTabsProps) {
  const nav = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; width: number; ready: boolean }>({ x: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const host = nav.current;
    if (!host) return;
    const measure = () => {
      const tab = host.querySelector<HTMLElement>(`[data-filter="${active}"]`);
      if (!tab) return;
      const inset = 2;
      const x = tab.offsetLeft + inset;
      const width = Math.max(tab.offsetWidth - inset * 2, 8);
      setIndicator((current) => ({ x, width, ready: current.ready || current.width > 0 }));
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(host);
    return () => observer?.disconnect();
  }, [active, counts]);

  return (
    <nav ref={nav} className="filter-tabs" aria-label="Capture filters">
      {filters.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          data-filter={value}
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
        data-filter="trash"
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
        style={{ transform: `translateX(${indicator.x}px) scaleX(${indicator.width})`, opacity: indicator.width ? 1 : 0 }}
      />
    </nav>
  );
}
