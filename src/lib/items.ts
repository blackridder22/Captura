import type {
  CaptureItem,
  ItemKind,
  QueueFilter,
  SectionFilter,
} from "../types";

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
    const matchesFilter =
      filter === "inbox"
        ? item.status === "open"
        : filter === "done"
          ? item.status === "done"
          : item.status === "open" &&
            item.kind === (filter === "prompts" ? "prompt" : "note");

    if (!matchesFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [item.content, item.sourceApp, item.kind]
      .filter(Boolean)
      .some((value) =>
        value?.toLocaleLowerCase().includes(normalizedQuery),
      );
  });
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

export function countItems(items: CaptureItem[]) {
  return {
    inbox: items.filter((item) => item.status === "open").length,
    prompts: items.filter(
      (item) => item.status === "open" && item.kind === "prompt",
    ).length,
    notes: items.filter(
      (item) => item.status === "open" && item.kind === "note",
    ).length,
    done: items.filter((item) => item.status === "done").length,
  };
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

