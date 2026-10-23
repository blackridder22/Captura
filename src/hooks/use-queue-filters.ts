import { useDeferredValue, useMemo, useState } from "react";
import { applySectionFilter, countItems, filterItems } from "../lib/items";
import type { CaptureItem, QueueFilter, SectionFilter } from "../types";

export function useQueueFilters(items: CaptureItem[]) {
  const [filter, setFilter] = useState<QueueFilter>("inbox");
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>("all");

  // Keystrokes paint first; the filtered list follows in a deferred render.
  const deferredQuery = useDeferredValue(query);
  const visibleItems = useMemo(
    () => applySectionFilter(filterItems(items, filter, deferredQuery), sectionFilter),
    [filter, items, deferredQuery, sectionFilter],
  );

  const counts = useMemo(() => countItems(items), [items]);

  return {
    filter,
    setFilter,
    query,
    setQuery,
    sectionFilter,
    setSectionFilter,
    visibleItems,
    counts,
  };
}
