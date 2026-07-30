import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  CaptureItem,
  CreateItemInput,
  PermissionStatus,
  Section,
  ShortcutAction,
  UpdateItemInput,
} from "../types";
import { defaultShortcuts } from "./shortcuts";

const demoStorageKey = "captura.demo.items.v1";
const demoSectionsKey = "captura.demo.sections.v1";
const demoSettingsKey = "captura.demo.settings.v1";

const demoItems: CaptureItem[] = [
  {
    id: "demo-launch-hook",
    kind: "prompt",
    content: "Ask for three sharper versions of the launch hook",
    status: "open",
    sourceApp: "ChatGPT",
    sourceBundleId: "com.openai.chat",
    sectionId: null,
    createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
  {
    id: "demo-copper-link",
    kind: "link",
    content: "https://shadcn.com/copper",
    status: "open",
    sourceApp: "Chrome",
    sourceBundleId: "com.google.Chrome",
    sectionId: null,
    createdAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
  },
  {
    id: "demo-accessibility",
    kind: "prompt",
    content:
      "Compare Tauri accessibility APIs with the clipboard fallback",
    status: "open",
    sourceApp: "ChatGPT",
    sourceBundleId: "com.openai.chat",
    sectionId: null,
    createdAt: new Date(Date.now() - 16 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
  },
  {
    id: "demo-disappear",
    kind: "note",
    content: "The queue should disappear the second I return to work",
    status: "open",
    sourceApp: null,
    sourceBundleId: null,
    sectionId: null,
    createdAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
  },
  {
    id: "demo-release",
    kind: "prompt",
    content: "Turn this answer into a release checklist",
    status: "open",
    sourceApp: "ChatGPT",
    sourceBundleId: "com.openai.chat",
    sectionId: null,
    createdAt: new Date(Date.now() - 36 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 36 * 60_000).toISOString(),
  },
];

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function readDemoItems() {
  const stored = localStorage.getItem(demoStorageKey);
  if (!stored) {
    localStorage.setItem(demoStorageKey, JSON.stringify(demoItems));
    return demoItems;
  }

  try {
    return (JSON.parse(stored) as CaptureItem[]).map((item) => ({
      ...item,
      sectionId: item.sectionId ?? null,
    }));
  } catch {
    localStorage.setItem(demoStorageKey, JSON.stringify(demoItems));
    return demoItems;
  }
}

function writeDemoItems(items: CaptureItem[]) {
  localStorage.setItem(demoStorageKey, JSON.stringify(items));
  return items;
}

export async function listItems() {
  if (isTauriRuntime()) {
    return invoke<CaptureItem[]>("list_items");
  }

  return readDemoItems();
}

export async function createItem(input: CreateItemInput) {
  if (isTauriRuntime()) {
    return invoke<CaptureItem>("create_item", input);
  }

  const now = new Date().toISOString();
  const item: CaptureItem = {
    id: crypto.randomUUID(),
    content: input.content.trim(),
    kind: input.kind,
    status: "open",
    sourceApp: input.sourceApp ?? null,
    sourceBundleId: null,
    sectionId: null,
    createdAt: now,
    updatedAt: now,
  };
  writeDemoItems([item, ...readDemoItems()]);
  return item;
}

export async function updateItem(input: UpdateItemInput) {
  if (isTauriRuntime()) {
    return invoke<CaptureItem>("update_item", input);
  }

  const updated = readDemoItems().map((item) =>
    item.id === input.id
      ? {
          ...item,
          content: input.content.trim(),
          kind: input.kind,
          updatedAt: new Date().toISOString(),
        }
      : item,
  );
  writeDemoItems(updated);
  return updated.find((item) => item.id === input.id)!;
}

export async function toggleItem(id: string) {
  if (isTauriRuntime()) {
    return invoke<CaptureItem>("toggle_item", { id });
  }

  const updated = readDemoItems().map((item) =>
    item.id === id
      ? {
          ...item,
          status: item.status === "open" ? ("done" as const) : ("open" as const),
          updatedAt: new Date().toISOString(),
        }
      : item,
  );
  writeDemoItems(updated);
  return updated.find((item) => item.id === id)!;
}

export async function deleteItem(id: string) {
  if (isTauriRuntime()) {
    return invoke<void>("delete_item", { id });
  }
  writeDemoItems(readDemoItems().filter((item) => item.id !== id));
}

function readDemoSections() {
  try {
    return JSON.parse(localStorage.getItem(demoSectionsKey) ?? "[]") as Section[];
  } catch {
    return [];
  }
}

function writeDemoSections(sections: Section[]) {
  localStorage.setItem(demoSectionsKey, JSON.stringify(sections));
  return sections;
}

export async function listSections() {
  if (isTauriRuntime()) {
    return invoke<Section[]>("list_sections");
  }
  return readDemoSections();
}

export async function createSection(name: string) {
  if (isTauriRuntime()) {
    return invoke<Section>("create_section", { name });
  }
  const section: Section = {
    id: crypto.randomUUID(),
    name: name.trim(),
    createdAt: new Date().toISOString(),
  };
  writeDemoSections([...readDemoSections(), section]);
  return section;
}

export async function moveItemsToSection(
  ids: string[],
  sectionId: string | null,
) {
  if (isTauriRuntime()) {
    return invoke<CaptureItem[]>("move_items_to_section", { ids, sectionId });
  }
  const now = new Date().toISOString();
  const updated = readDemoItems().map((item) =>
    ids.includes(item.id) ? { ...item, sectionId, updatedAt: now } : item,
  );
  writeDemoItems(updated);
  return updated.filter((item) => ids.includes(item.id));
}

export async function mergeItems(ids: string[]) {
  if (isTauriRuntime()) {
    return invoke<CaptureItem>("merge_items", { ids });
  }

  const selected = ids
    .map((id) => readDemoItems().find((item) => item.id === id))
    .filter((item): item is CaptureItem => Boolean(item));
  const now = new Date().toISOString();
  const sectionId = selected.every(
    (item) => item.sectionId === selected[0]?.sectionId,
  )
    ? (selected[0]?.sectionId ?? null)
    : null;
  const merged: CaptureItem = {
    id: crypto.randomUUID(),
    kind: "note",
    content: selected.map((item) => item.content.trim()).join("\n\n"),
    status: "open",
    sourceApp: null,
    sourceBundleId: null,
    sectionId,
    createdAt: now,
    updatedAt: now,
  };
  writeDemoItems([
    merged,
    ...readDemoItems().filter((item) => !ids.includes(item.id)),
  ]);
  return merged;
}

export async function pasteItem(id: string) {
  if (isTauriRuntime()) {
    return invoke<CaptureItem>("paste_item", { id });
  }
  return toggleItem(id);
}

export async function hideMainWindow() {
  if (isTauriRuntime()) {
    await invoke("hide_main_window");
  }
}

export async function quitApp() {
  if (isTauriRuntime()) {
    await invoke("quit_app");
  }
}

export async function permissionStatus() {
  if (isTauriRuntime()) {
    return invoke<PermissionStatus>("permission_status");
  }
  return {
    accessibilityTrusted: true,
    postEventTrusted: true,
    globalShortcutRegistered: true,
  } satisfies PermissionStatus;
}

function readDemoSettings(): AppSettings {
  try {
    const stored = JSON.parse(
      localStorage.getItem(demoSettingsKey) ?? "{}",
    ) as Partial<AppSettings>;
    return {
      shortcuts: { ...defaultShortcuts, ...stored.shortcuts },
      keepOpen: stored.keepOpen ?? false,
    };
  } catch {
    return { shortcuts: { ...defaultShortcuts }, keepOpen: false };
  }
}

function writeDemoSettings(settings: AppSettings) {
  localStorage.setItem(demoSettingsKey, JSON.stringify(settings));
  return settings;
}

export async function getAppSettings() {
  if (isTauriRuntime()) {
    return invoke<AppSettings>("get_app_settings");
  }
  return readDemoSettings();
}

export async function setShortcut(
  action: ShortcutAction,
  shortcut: string,
) {
  if (isTauriRuntime()) {
    return invoke<AppSettings>("set_shortcut", { action, shortcut });
  }
  const settings = readDemoSettings();
  return writeDemoSettings({
    ...settings,
    shortcuts: { ...settings.shortcuts, [action]: shortcut },
  });
}

export async function resetShortcuts() {
  if (isTauriRuntime()) {
    return invoke<AppSettings>("reset_shortcuts");
  }
  const settings = readDemoSettings();
  return writeDemoSettings({
    ...settings,
    shortcuts: { ...defaultShortcuts },
  });
}

export async function setKeepOpen(keepOpen: boolean) {
  if (isTauriRuntime()) {
    return invoke<AppSettings>("set_keep_open", { keepOpen });
  }
  return writeDemoSettings({ ...readDemoSettings(), keepOpen });
}

export async function captureClipboardNow() {
  if (isTauriRuntime()) {
    await invoke("capture_clipboard_now");
  }
}

export async function requestAccessibility() {
  if (isTauriRuntime()) {
    return invoke<boolean>("request_accessibility");
  }
  return true;
}

export async function onCaptured(
  handler: (item: CaptureItem) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return listen<CaptureItem>("captura://captured", (event) =>
    handler(event.payload),
  );
}

export async function onFocusComposer(
  handler: () => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return listen("captura://focus-composer", handler);
}

export async function onHudCapture(
  handler: (item: CaptureItem) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return listen<CaptureItem>("captura://hud", (event) =>
    handler(event.payload),
  );
}
