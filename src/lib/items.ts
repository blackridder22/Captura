import type {
  CaptureItem,
  ItemKind,
  QueueFilter,
  SectionFilter,
} from "../types";

// Iterate only the visible excerpt. Array.from(content) would allocate the
// entire document each time a long capture is rendered in the queue.
export function markdownExcerpt(content: string, limit = 1024): string {
  if (content.length <= limit) return content;
  let excerpt = "";
  let count = 0;
  for (const character of content) {
    if (count++ === limit) break;
    excerpt += character;
  }
  return excerpt;
}

export function inferKind(content: string): ItemKind {
  const value = content.trim();

  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return "link";
    }
  } catch {
    // The capture is ordinary text.
  }

  const promptStart =
    /^(ask|compare|create|draft|explain|find|give|rewrite|summarize|turn|write)\b/i;
  if (promptStart.test(value) || value.endsWith("?")) {
    return "prompt";
  }

  return "note";
}

export function filterItems(
  items: CaptureItem[],
  filter: QueueFilter,
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return items.filter((item) => {
    if (!matchesQueueFilter(item, filter)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return searchText(item).includes(normalizedQuery);
  });
}

/// Trash is its own world: trashed captures never appear in the live filters
/// and live captures never appear in Trash.
export function matchesQueueFilter(item: CaptureItem, filter: QueueFilter) {
  if (filter === "trash") return item.deletedAt !== null;
  if (item.deletedAt !== null) return false;
  if (filter === "inbox") return item.status === "open";
  if (filter === "done") return item.status === "done";
  return (
    item.status === "open" &&
    item.kind === (filter === "prompts" ? "prompt" : "note")
  );
}

// Lowercasing the full content on every keystroke dominated search cost;
// cache per capture version instead (content only changes with updatedAt).
const searchTextCache = new WeakMap<CaptureItem, string>();
export function searchText(item: CaptureItem) {
  let cached = searchTextCache.get(item);
  if (cached === undefined) {
    cached = [item.content, item.sourceApp, item.kind]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase();
    searchTextCache.set(item, cached);
  }
  return cached;
}

export function applySectionFilter(
  items: CaptureItem[],
  sectionFilter: SectionFilter,
) {
  if (sectionFilter === "all") return items;
  if (sectionFilter === "unfiled") {
    return items.filter((item) => !item.sectionId);
  }
  return items.filter((item) => item.sectionId === sectionFilter);
}

export function countItems(items: CaptureItem[]): Record<QueueFilter, number> {
  const counts = { inbox: 0, prompts: 0, notes: 0, done: 0, trash: 0 };
  for (const item of items) {
    if (item.deletedAt !== null) {
      counts.trash += 1;
    } else if (item.status === "done") {
      counts.done += 1;
    } else {
      counts.inbox += 1;
      if (item.kind === "prompt") counts.prompts += 1;
      else if (item.kind === "note") counts.notes += 1;
    }
  }
  return counts;
}

export const trashRetentionLabel: Record<"immediate" | "7d" | "28d", string> = {
  immediate: "Deleted captures are removed immediately.",
  "7d": "Auto-deletes after 7 days.",
  "28d": "Auto-deletes after 28 days.",
};

/** Title for the capture page: first non-empty line, Markdown markers stripped. */
export function captureTitle(content: string, fallback = "Untitled capture") {
  const line = content
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  if (!line) return fallback;
  const plain = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/[*_`~]/g, "")
    .trim();
  return plain || fallback;
}

export function formatCaptureTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}
