import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDetailRequest, CaptureItem, CapturesChangedEvent } from "../types";
import * as api from "../lib/api";
import CaptureSheet from "./capture-sheet";
import { defaultShortcuts } from "../lib/shortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const onClose = vi.fn();
let nativeChange: (change: CapturesChangedEvent) => void;
vi.mock("../lib/api", () => ({
  getCaptureDetails: vi.fn(), updateItem: vi.fn(),
  copyItems: vi.fn(), attachmentUrl: (value: string) => value,
  onCapturesChanged: vi.fn(async (handler) => { nativeChange = handler; return vi.fn(); }),
}));
const first: CaptureItem = { id: "first", kind: "note", content: "# First\n\nText", status: "open", sourceApp: null, sourceBundleId: null, sectionId: null, attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null, createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:00:00.000000001Z" };
const second = { ...first, id: "second", content: "# Second" };
function click(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text || element.getAttribute("aria-label") === text);
  if (!button) throw new Error(`Button missing: ${text}`);
  button.click();
}
function type(container: HTMLElement, text: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("in-panel capture preview and editor lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCaptureDetails).mockImplementation(async (ids) => ids.map((id) => id === "first" ? first : second));
    vi.mocked(api.updateItem).mockImplementation(async (input) => ({ ...first, ...input, updatedAt: "2026-09-05T10:00:00.000000002Z" }));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });
  const mount = async (request: CaptureDetailRequest = { ids: ["first"], mode: "preview" }) => { await act(async () => { root.render(<CaptureSheet request={request} shortcuts={defaultShortcuts} onClose={onClose} />); }); };

  it("opens a read-only Markdown overlay, then exposes the editor with Source and Preview tabs", async () => {
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe("First");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    act(() => click(container, "Edit"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(first.content);
    expect(document.activeElement).toBe(container.querySelector("textarea"));
    expect(container.querySelector('[role="dialog"]')?.parentElement?.classList.contains("capture-backdrop")).toBe(true);
    expect(container.querySelector("[data-capture-preview]")).toBeNull();
    act(() => click(container, "Preview"));
    expect(container.querySelector("h1")?.textContent).toBe("First");
  });

  it("opens directly in the editor and contains Escape within the overlay", async () => {
    await mount({ ids: ["first"], mode: "edit" });
    const source = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(document.activeElement).toBe(source);
    expect(source.value).toBe(first.content);
    act(() => type(container, "unsaved draft"));
    const queueKey = vi.fn();
    window.addEventListener("keydown", queueKey);
    act(() => source.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(queueKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", queueKey);
  });

  it("leaves Enter available to buttons and Markdown links instead of opening the editor", async () => {
    vi.mocked(api.getCaptureDetails).mockResolvedValueOnce([{ ...first, content: "# Links\n\n[Documentation](https://example.com)" }]);
    await mount();
    const controls = [container.querySelector("button")!, container.querySelector("a")!];
    for (const control of controls) {
      const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      act(() => { control.focus(); control.dispatchEvent(enter); });
      expect(enter.defaultPrevented).toBe(false);
      expect(container.querySelector<HTMLElement>(".capture-sheet")?.dataset.mode).toBe("preview");
    }
  });

  it("reads the full image and edits its caption without changing its image kind", async () => {
    const image = { ...first, kind: "image" as const, attachmentPath: "/full.png", thumbnailPath: "/thumbnail.png", imageWidth: 4000, imageHeight: 3000 };
    vi.mocked(api.getCaptureDetails).mockResolvedValueOnce([image]);
    vi.mocked(api.updateItem).mockImplementationOnce(async (input) => ({ ...image, ...input, updatedAt: "2026-09-05T10:00:01Z" }));
    await mount();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/full.png");
    act(() => click(container, "Edit"));
    expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe("Image caption");
    act(() => type(container, "New caption"));
    await act(async () => click(container, "Save changes"));
    expect(api.updateItem).toHaveBeenCalledWith(expect.objectContaining({ content: "New caption", kind: "image" }));
  });

  it("preserves every Markdown source character and expected timestamp when saving", async () => {
    await mount(); act(() => click(container, "Edit"));
    const draft = "  # Indented\n\nLine with hard break  \n\n";
    act(() => type(container, draft));
    await act(async () => click(container, "Save changes"));
    expect(api.updateItem).toHaveBeenCalledWith({ id: first.id, content: draft, kind: "note", expectedUpdatedAt: first.updatedAt });
    expect(container.querySelector<HTMLElement>(".capture-sheet")?.dataset.mode).toBe("preview");
    act(() => click(container, "Edit"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(draft);
  });

  it("keeps a failed save in the editor with its original draft", async () => {
    vi.mocked(api.updateItem).mockRejectedValueOnce(new Error("Disk full"));
    await mount(); act(() => click(container, "Edit")); act(() => type(container, "# Keep this draft\n"));
    await act(async () => click(container, "Save changes"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("# Keep this draft\n");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    expect(container.querySelector<HTMLElement>(".capture-sheet")?.dataset.mode).toBe("edit");
    expect(document.activeElement).toBe(container.querySelector("textarea"));
  });

  it("guards closing the overlay, keeps the draft on Cancel and closes on Discard", async () => {
    await mount(); act(() => click(container, "Edit")); act(() => type(container, "unsaved"));
    act(() => click(container, "Close capture"));
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => click(container.querySelector('[role="alertdialog"]')!, "Cancel"));
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("unsaved");
    act(() => click(container, "Close capture"));
    await act(async () => click(container.querySelector('[role="alertdialog"]')!, "Discard"));
    expect(onClose).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")).toBeNull();
    await mount({ ids: ["second"], mode: "preview" });
    expect(container.querySelector("h1")?.textContent).toBe("Second");
  });

  it("keeps requested preview order and guards navigation away from a dirty capture", async () => {
    await mount({ ids: ["second", "first"], mode: "preview" });
    expect(container.querySelector("h1")?.textContent).toBe("Second");
    act(() => click(container, "Edit")); act(() => type(container, "second draft"));
    act(() => click(container, "Next capture"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("second draft");
    await act(async () => click(container.querySelector('[role="alertdialog"]')!, "Discard"));
    expect(container.querySelector("h1")?.textContent).toBe("First");
    expect(container.textContent).toContain("2 of 2");
  });

  it("renders the current draft when switching to Preview and retains source when switching back", async () => {
    await mount();
    act(() => click(container, "Edit"));
    expect(container.querySelector('[data-capture-preview]')).toBeNull();
    act(() => type(container, "## Updated"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("## Updated");
    act(() => click(container, "Preview"));
    expect(container.querySelector("h2")?.textContent).toBe("Updated");
    act(() => click(container, "Source"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("## Updated");
  });

  it("retains deleted capture drafts and never offers to save them back", async () => {
    await mount(); act(() => click(container, "Edit")); act(() => type(container, "recoverable draft"));
    act(() => nativeChange({ revision: 1, upserts: [], deletedIds: [first.id] }));
    expect(container.textContent).toContain("This capture is no longer available.");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("recoverable draft");
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save changes")!;
    expect(save.disabled).toBe(true);
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it("keeps draft conflict state when a later commit arrives within the same millisecond", async () => {
    await mount(); act(() => click(container, "Edit")); act(() => type(container, "my draft"));
    act(() => nativeChange({ revision: 3, upserts: [{ ...first, content: "remote change", updatedAt: "2026-09-05T10:00:00.000000003Z" }], deletedIds: [] }));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("my draft");
    expect(container.textContent).toContain("This capture changed elsewhere.");
    vi.mocked(api.updateItem).mockRejectedValueOnce(new Error("Capture changed"));
    await act(async () => click(container, "Save changes"));
    expect(api.updateItem).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: first.updatedAt }));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("my draft");
  });
});
