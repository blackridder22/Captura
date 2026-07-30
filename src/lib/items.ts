import type {
  CaptureItem,
  ItemKind,
  QueueFilter,
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

