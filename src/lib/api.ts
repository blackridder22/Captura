import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  CaptureItem,
  CaptureDetailRequest,
  CapturesChangedEvent,
  CopyMode,
  CopyResult,
  CreateItemInput,
  ImageImportInput,
  ImageImportResult,
  PermissionRequiredEvent,
  PermissionStatus,
  QueueSnapshot,
  Section,
  ShortcutAction,
  UpdateItemInput,
} from "../types";
import { defaultShortcuts } from "./shortcuts";

const demoStorageKey = "captura.demo.items.v1";
const demoSectionsKey = "captura.demo.sections.v1";
const demoSettingsKey = "captura.demo.settings.v1";
const demoAccessibilitySetupSeenKey = "captura.demo.accessibility-setup-seen.v1";
const demoRevisionKey = "captura.demo.revision.v1";
const demoDetailKey = "captura.demo.detail.v1";

function demoRevision() {
  return Number(localStorage.getItem(demoRevisionKey) ?? 0);
}

const demoItems: CaptureItem[] = [
  {
    id: "demo-launch-hook",
    kind: "prompt",
    content: "Ask for three sharper versions of the launch hook",
    status: "open",
    sourceApp: "ChatGPT",
    sourceBundleId: "com.openai.chat",
    sectionId: null,
    attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null,
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
    attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null,
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
    attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null,
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
    attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null,
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
    attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null,
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
      thumbnailPath: item.thumbnailPath ?? null,
      imageWidth: item.imageWidth ?? null,
      imageHeight: item.imageHeight ?? null,
    }));
  } catch {
    localStorage.setItem(demoStorageKey, JSON.stringify(demoItems));
    return demoItems;
  }
}

function writeDemoItems(items: CaptureItem[]) {
  const previous = readDemoItems();
  const currentIds = new Set(items.map((item) => item.id));
  const revision = demoRevision() + 1;
  localStorage.setItem(demoRevisionKey, String(revision));
  localStorage.setItem(demoStorageKey, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent<CapturesChangedEvent>("captura://captures-changed", {
    detail: {
      revision,
      upserts: items.filter((item) => !previous.some((old) => JSON.stringify(old) === JSON.stringify(item))),
      deletedIds: previous.filter((item) => !currentIds.has(item.id)).map((item) => item.id),
    },
  }));
  return items;
}

export async function snapshotQueue(): Promise<QueueSnapshot> {
  if (isTauriRuntime()) return invoke<QueueSnapshot>("snapshot_queue");
  return {
    revision: demoRevision(),
    items: readDemoItems(),
    sections: readDemoSections(),
    settings: readDemoSettings(),
  };
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
    content: input.content,
    kind: input.kind,
    status: "open",
    sourceApp: input.sourceApp ?? null,
    sourceBundleId: null,
    sectionId: null,
    attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null,
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

  const previous = readDemoItems();
  const current = previous.find((item) => item.id === input.id);
  if (!current) throw new Error("This capture is no longer available.");
  if (current.updatedAt !== input.expectedUpdatedAt) {
    throw new Error("This capture changed while you were editing. Your draft has been kept.");
  }
  if (!input.content.trim()) throw new Error("A capture cannot be empty.");
  const updated = previous.map((item) =>
    item.id === input.id
      ? {
          ...item,
          content: input.content,
          kind: input.kind,
          updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString(),
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

type DemoCopyPayload =
  | { kind: "text"; text: string; result: CopyResult }
  | { kind: "image"; path: string; result: CopyResult };

function collapseNewlinesForList(content: string) {
  return content.trim().replace(/[\r\n]+/g, " ");
}

export function buildDemoCopyPayload(
  items: CaptureItem[],
  mode: CopyMode,
): DemoCopyPayload {
  if (!items.length) throw new Error("Select at least one capture to copy.");

  if (mode === "native") {
    if (items.length !== 1) {
      throw new Error("Native copy supports one capture at a time.");
    }
    const item = items[0]!;
    if (item.kind === "image") {
      if (!item.attachmentPath) {
        throw new Error("This image capture has no stored file.");
      }
      return {
        kind: "image",
        path: item.attachmentPath,
        result: { format: "image", count: 1 },
      };
    }
    return {
      kind: "text",
      text: item.content,
      result: { format: "markdown", count: 1 },
    };
  }

  if (items.some((item) => item.kind === "image")) {
    throw new Error("Select only text captures to copy Markdown.");
  }
  if (mode === "sourceMarkdown") {
    return {
      kind: "text",
      text: items.map((item) => item.content).join("\n\n"),
      result: { format: "markdown", count: items.length },
    };
  }
  return {
    kind: "text",
    text: items
      .map((item) => `- ${collapseNewlinesForList(item.content)}`)
      .join("\n"),
    result: { format: "markdownList", count: items.length },
  };
}

export async function copyItems(ids: string[], mode: CopyMode) {
  if (isTauriRuntime()) {
    return invoke<CopyResult>("copy_items", { ids, mode });
  }

  const stored = readDemoItems();
  const items = ids.map((id) => {
    const item = stored.find((candidate) => candidate.id === id);
    if (!item) throw new Error("Capture not found.");
    return item;
  });
  const payload = buildDemoCopyPayload(items, mode);
  if (payload.kind === "text") {
    await navigator.clipboard.writeText(payload.text);
  } else {
    if (!("ClipboardItem" in window) || !navigator.clipboard.write) {
      throw new Error("Image copying is unavailable in this browser preview.");
    }
    const response = await fetch(attachmentUrl(payload.path));
    if (!response.ok) throw new Error("The image file for this capture is missing.");
    const blob = await response.blob();
    const png =
      blob.type === "image/png"
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: "image/png" });
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
  }
  return payload.result;
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

export async function deleteSection(id: string) {
  if (isTauriRuntime()) {
    return invoke<CaptureItem[]>("delete_section", { id });
  }
  if (!readDemoSections().some((section) => section.id === id)) {
    throw new Error("Section not found.");
  }
  writeDemoSections(readDemoSections().filter((section) => section.id !== id));
  const now = new Date().toISOString();
  const affectedIds = readDemoItems()
    .filter((item) => item.sectionId === id)
    .map((item) => item.id);
  const updated = readDemoItems().map((item) =>
    item.sectionId === id
      ? { ...item, sectionId: null, updatedAt: now }
      : item,
  );
  writeDemoItems(updated);
  return updated.filter((item) => affectedIds.includes(item.id));
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
    attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null,
    createdAt: now,
    updatedAt: now,
  };
  writeDemoItems([
    merged,
    ...readDemoItems().filter((item) => !ids.includes(item.id)),
  ]);
  return merged;
}

export async function chooseImageFiles(input: ImageImportInput): Promise<ImageImportResult> {
  if (isTauriRuntime()) return invoke<ImageImportResult>("choose_image_files", input);
  throw new Error("Open Captura to choose image files.");
}

export async function pasteImageFromClipboard(input: ImageImportInput): Promise<ImageImportResult> {
  if (isTauriRuntime()) return invoke<ImageImportResult>("paste_image_from_clipboard", input);
  throw new Error("Open Captura to paste images from the clipboard.");
}

export async function ensureImageThumbnail(id: string): Promise<CaptureItem> {
  if (isTauriRuntime()) return invoke<CaptureItem>("ensure_image_thumbnail", { id });
  throw new Error("Image thumbnails are available in Captura.");
}

export async function cleanupImageFiles(): Promise<void> {
  if (isTauriRuntime()) return invoke<void>("cleanup_image_files");
}

/// Resolves an attachment's on-disk path to a URL the WebView may load.
export function attachmentUrl(path: string) {
  if (isTauriRuntime()) {
    return convertFileSrc(path);
  }
  return path;
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

export async function showMainWindow() {
  if (isTauriRuntime()) {
    await invoke("show_main_window");
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
    setupSeen:
      localStorage.getItem(demoAccessibilitySetupSeenKey) !== "false",
  } satisfies PermissionStatus;
}

export async function markAccessibilitySetupSeen() {
  if (isTauriRuntime()) {
    return invoke<PermissionStatus>("mark_accessibility_setup_seen");
  }
  localStorage.setItem(demoAccessibilitySetupSeenKey, "true");
  return permissionStatus();
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

export async function openAccessibilitySettings() {
  if (isTauriRuntime()) {
    await invoke("open_accessibility_settings");
  }
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

export async function onPermissionRequired(
  handler: (event: PermissionRequiredEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return listen<PermissionRequiredEvent>(
    "captura://permission-required",
    (event) => handler(event.payload),
  );
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

export async function openCaptureDetail(request: CaptureDetailRequest) {
  if (isTauriRuntime()) return invoke<void>("open_capture_detail", request);
  localStorage.setItem(demoDetailKey, JSON.stringify({ ...request, requestedAt: Date.now() }));
  const detail = window.open("?detail=1", "captura-detail", "width=760,height=600");
  if (!detail) throw new Error("Allow the preview window to read this capture.");
  detail.focus();
}

export async function getDetailRequest(): Promise<CaptureDetailRequest | null> {
  if (isTauriRuntime()) return invoke<CaptureDetailRequest | null>("get_detail_request");
  return JSON.parse(localStorage.getItem(demoDetailKey) ?? "null") as CaptureDetailRequest | null;
}

export async function getCaptureDetails(ids: string[]): Promise<CaptureItem[]> {
  if (isTauriRuntime()) return invoke<CaptureItem[]>("get_capture_details", { ids });
  const items = new Map(readDemoItems().map((item) => [item.id, item]));
  return ids.flatMap((id) => items.has(id) ? [items.get(id)!] : []);
}

export async function closeCaptureDetail() {
  if (isTauriRuntime()) return invoke<void>("close_capture_detail");
  window.close();
}

export async function onDetailRequest(handler: (request: CaptureDetailRequest) => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen<CaptureDetailRequest>("captura://detail-request", (event) => handler(event.payload));
  const storage = (event: StorageEvent) => {
    if (event.key === demoDetailKey && event.newValue) handler(JSON.parse(event.newValue) as CaptureDetailRequest);
  };
  window.addEventListener("storage", storage);
  return () => window.removeEventListener("storage", storage);
}

export async function onDetailCloseRequested(handler: () => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen("captura://detail-close-requested", handler);
  return () => undefined;
}

export async function onCapturesChanged(handler: (event: CapturesChangedEvent) => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen<CapturesChangedEvent>("captura://captures-changed", (event) => handler(event.payload));
  let previousIds = readDemoItems().map((item) => item.id);
  const local = (event: Event) => handler((event as CustomEvent<CapturesChangedEvent>).detail);
  const storage = (event: StorageEvent) => {
    if (event.key !== demoStorageKey) return;
    const items = readDemoItems();
    const currentIds = new Set(items.map((item) => item.id));
    handler({ revision: demoRevision(), upserts: items, deletedIds: previousIds.filter((id) => !currentIds.has(id)) });
    previousIds = items.map((item) => item.id);
  };
  window.addEventListener("captura://captures-changed", local);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener("captura://captures-changed", local);
    window.removeEventListener("storage", storage);
  };
}

export async function onImageImportCompleted(handler: (result: ImageImportResult) => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen<ImageImportResult>("captura://image-import-completed", (event) => handler(event.payload));
  return () => undefined;
}

export async function onCaptureError(handler: (message: string) => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) return listen<string>("captura://capture-error", (event) => handler(event.payload));
  return () => undefined;
}
