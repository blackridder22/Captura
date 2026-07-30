import type { KeyboardShortcutSettings, ShortcutAction } from "../types";

export const defaultShortcuts: KeyboardShortcutSettings = {
  capture: "Alt+Space",
  save: "Command+Enter",
  paste: "Command+Enter",
  search: "Command+F",
  close: "Command+W",
  dismiss: "Escape",
  next: "ArrowDown",
  previous: "ArrowUp",
  copy: "Command+C",
  copyAsList: "Shift+Command+C",
  markDone: "Space",
  edit: "Enter",
  merge: "Shift+Command+M",
  delete: "Command+Backspace",
};

export const shortcutActions: {
  action: ShortcutAction;
  label: string;
  description: string;
}[] = [
  {
    action: "capture",
    label: "Global capture",
    description: "Capture a selection from any app.",
  },
  {
    action: "save",
    label: "Save capture",
    description: "Save the quick composer.",
  },
  {
    action: "paste",
    label: "Paste back",
    description: "Paste the active capture into the previous app.",
  },
  {
    action: "search",
    label: "Search",
    description: "Focus capture search.",
  },
  {
    action: "close",
    label: "Close panel",
    description: "Hide Captura without quitting.",
  },
  {
    action: "dismiss",
    label: "Dismiss",
    description: "Close the current menu, sheet, or panel.",
  },
  {
    action: "next",
    label: "Next capture",
    description: "Move selection down.",
  },
  {
    action: "previous",
    label: "Previous capture",
    description: "Move selection up.",
  },
  {
    action: "copy",
    label: "Copy",
    description: "Copy selected captures.",
  },
  {
    action: "copyAsList",
    label: "Copy as list",
    description: "Copy selected captures as Markdown bullets.",
  },
  {
    action: "markDone",
    label: "Mark done",
    description: "Toggle selected captures.",
  },
  {
    action: "edit",
    label: "Edit",
    description: "Edit the active capture.",
  },
  {
    action: "merge",
    label: "Merge",
    description: "Merge multiple selected captures.",
  },
  {
    action: "delete",
    label: "Delete",
    description: "Delete selected captures.",
  },
];

const modifierOrder = ["Control", "Alt", "Shift", "Command"] as const;
const modifierKeys = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "Shift",
]);

const keyLabels: Record<string, string> = {
  Space: "Space",
  Enter: "↩",
  Escape: "Esc",
  Tab: "⇥",
  Backspace: "⌫",
  Delete: "⌦",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

function eventKey(event: Pick<KeyboardEvent, "key" | "code">) {
  if (event.code.startsWith("Key")) return event.code.slice(3);
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(event.code)) return event.code;

  switch (event.code) {
    case "Space":
      return "Space";
    case "NumpadEnter":
      return "Enter";
    case "NumpadAdd":
      return "Plus";
    case "NumpadSubtract":
      return "Minus";
    default:
      break;
  }

  if (event.key === " ") return "Space";
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

export function shortcutFromEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "altKey" | "ctrlKey" | "shiftKey"
  >,
) {
  if (modifierKeys.has(event.key)) return null;

  const key = eventKey(event);
  if (!key || key === "Unidentified" || key === "Dead") return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Command");
  return [...modifiers, key].join("+");
}

export function normalizeShortcut(shortcut: string) {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.at(-1) ?? "";
  const modifiers = new Set(
    parts.slice(0, -1).map((part) => {
      const lower = part.toLocaleLowerCase();
      if (lower === "cmd" || lower === "meta") return "Command";
      if (lower === "ctrl") return "Control";
      if (lower === "option") return "Alt";
      return `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`;
    }),
  );
  return [
    ...modifierOrder.filter((modifier) => modifiers.has(modifier)),
    key.length === 1 ? key.toUpperCase() : key,
  ]
    .filter(Boolean)
    .join("+");
}

export function matchesShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "altKey" | "ctrlKey" | "shiftKey"
  >,
  shortcut: string,
  allowExtraShift = false,
) {
  const fromEvent = shortcutFromEvent(event);
  if (!fromEvent) return false;
  if (normalizeShortcut(fromEvent) === normalizeShortcut(shortcut)) return true;
  if (!allowExtraShift || !event.shiftKey) return false;
  return (
    normalizeShortcut(fromEvent.replace("Shift+", "")) ===
    normalizeShortcut(shortcut)
  );
}

export function shortcutLabel(shortcut: string) {
  const parts = normalizeShortcut(shortcut).split("+");
  return parts
    .map((part) => {
      if (part === "Command") return "⌘";
      if (part === "Shift") return "⇧";
      if (part === "Alt") return "⌥";
      if (part === "Control") return "⌃";
      return keyLabels[part] ?? part;
    })
    .join("");
}

export function hasModifier(shortcut: string) {
  const normalized = normalizeShortcut(shortcut);
  return modifierOrder.some((modifier) =>
    normalized.split("+").includes(modifier),
  );
}
