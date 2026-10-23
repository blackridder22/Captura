import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultShortcuts } from "../lib/shortcuts";
import type { AppSettings } from "../types";
import { SettingsSheet } from "./settings-sheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings: AppSettings = { shortcuts: { ...defaultShortcuts }, keepOpen: false, trashRetention: "7d", defaultCaptureView: "page" };
const handlers = {
  onClose: vi.fn(), onRequestAccessibility: vi.fn(async () => {}), onShortcutChange: vi.fn(async () => {}), onResetShortcuts: vi.fn(async () => {}),
  onKeepOpenChange: vi.fn(async () => {}), onTrashRetentionChange: vi.fn(async () => {}), onDefaultCaptureViewChange: vi.fn(async () => {}),
  onEmptyTrash: vi.fn(async () => {}), onCaptureClipboard: vi.fn(async () => {}), onQuit: vi.fn(async () => {}), onCheckUpdates: vi.fn(async () => {}), onInstallUpdate: vi.fn(async () => {}),
};
const click = (container: HTMLElement, text: string) => {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text || element.getAttribute("aria-label") === text);
  if (!button) throw new Error(`Button missing: ${text}`);
  button.click();
};

describe("SettingsSheet sections", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { vi.clearAllMocks(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const mount = (trashCount = 0) => act(() => { root.render(<SettingsSheet permissions={{ accessibilityTrusted: true, postEventTrusted: true, globalShortcutRegistered: true, setupSeen: true }} settings={settings} trashCount={trashCount} updateStatus={{ phase: "idle" }} {...handlers} />); });

  it("opens on General and switches sections through the nav", () => {
    mount();
    expect(container.textContent).toContain("Keep Captura open");
    expect(container.querySelector(".shortcut-settings")).toBeNull();
    act(() => click(container, "Shortcuts"));
    expect(container.querySelectorAll(".shortcut-setting").length).toBe(17);
    expect(container.textContent).toContain("Select all");
    act(() => click(container, "Trash"));
    act(() => click(container, "28 days"));
    expect(handlers.onTrashRetentionChange).toHaveBeenCalledWith("28d");
    act(() => click(container, "Editor"));
    act(() => click(container, "Source"));
    expect(handlers.onDefaultCaptureViewChange).toHaveBeenCalledWith("source");
  });

  it("asks before emptying Trash and disables it when empty", () => {
    mount(0);
    act(() => click(container, "Trash"));
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Empty")?.disabled).toBe(true);
    act(() => root.unmount()); root = createRoot(container);
    mount(3);
    act(() => click(container, "Trash"));
    act(() => click(container, "Empty"));
    expect(handlers.onEmptyTrash).not.toHaveBeenCalled();
    act(() => click(container, "Delete all"));
    expect(handlers.onEmptyTrash).toHaveBeenCalledOnce();
  });
});
