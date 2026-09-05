import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDetailRequest, CaptureItem, CapturesChangedEvent } from "../types";
import * as api from "../lib/api";
import CaptureDetail from "./capture-detail";
import { defaultShortcuts } from "../lib/shortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let nativeRequest: (request: CaptureDetailRequest) => void;
let nativeClose: () => void;
let nativeChange: (change: CapturesChangedEvent) => void;
vi.mock("../lib/api", () => ({
  getDetailRequest: vi.fn(), getCaptureDetails: vi.fn(), updateItem: vi.fn(), closeCaptureDetail: vi.fn(),
  getAppSettings: vi.fn(), copyItems: vi.fn(), attachmentUrl: (value: string) => value,
  onDetailRequest: vi.fn(async (handler) => { nativeRequest = handler; return vi.fn(); }),
  onDetailCloseRequested: vi.fn(async (handler) => { nativeClose = handler; return vi.fn(); }),
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

describe("standalone capture reader and draft lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 760 });
    vi.mocked(api.getDetailRequest).mockResolvedValue({ ids: ["first"], mode: "preview" });
    vi.mocked(api.getCaptureDetails).mockImplementation(async (ids) => ids.map((id) => id === "first" ? first : second));
    vi.mocked(api.getAppSettings).mockResolvedValue({ keepOpen: false, shortcuts: defaultShortcuts });
    vi.mocked(api.updateItem).mockImplementation(async (input) => ({ ...first, ...input, updatedAt: "2026-09-05T10:00:00.000000002Z" }));
    vi.mocked(api.closeCaptureDetail).mockResolvedValue();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });
  const mount = async () => { await act(async () => { root.render(<CaptureDetail />); }); };

  it("opens preview, then edits source immediately beside the rendered Markdown", async () => {
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe("First");
    expect(container.querySelector("textarea")).toBeNull();
    act(() => click(container, "Edit"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(first.content);
    expect(document.activeElement).toBe(container.querySelector("textarea"));
    expect(container.querySelector('[data-split="true"]')).not.toBeNull();
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
    expect(container.querySelector("main")?.dataset.mode).toBe("preview");
    act(() => click(container, "Source"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(draft);
  });

  it("keeps a failed save in the editor with its original draft", async () => {
    vi.mocked(api.updateItem).mockRejectedValueOnce(new Error("Disk full"));
    await mount(); act(() => click(container, "Edit")); act(() => type(container, "# Keep this draft\n"));
    await act(async () => click(container, "Save changes"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("# Keep this draft\n");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    expect(container.querySelector("main")?.dataset.mode).toBe("edit");
  });

  it("guards native close, preserves on Cancel, then clears the hidden reader on Discard", async () => {
    await mount(); act(() => click(container, "Edit")); act(() => type(container, "unsaved"));
    act(() => nativeClose());
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => click(container.querySelector('[role="alertdialog"]')!, "Cancel"));
    expect(api.closeCaptureDetail).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("unsaved");
    act(() => nativeClose());
    await act(async () => click(container.querySelector('[role="alertdialog"]')!, "Discard"));
    expect(api.closeCaptureDetail).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")).toBeNull();
    await act(async () => nativeRequest({ ids: ["second"], mode: "preview" }));
    expect(container.querySelector("h1")?.textContent).toBe("Second");
  });

  it("keeps requested preview order and guards navigation away from a dirty capture", async () => {
    vi.mocked(api.getDetailRequest).mockResolvedValue({ ids: ["second", "first"], mode: "preview" });
    await mount();
    expect(container.querySelector("h1")?.textContent).toBe("Second");
    act(() => click(container, "Edit")); act(() => type(container, "second draft"));
    act(() => click(container, "Next capture"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("second draft");
    await act(async () => click(container.querySelector('[role="alertdialog"]')!, "Discard"));
    expect(container.querySelector("h1")?.textContent).toBe("First");
    expect(container.textContent).toContain("2 of 2");
  });

  it("debounces the preview without delaying source input and preserves the draft across narrow tabs", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    await mount();
    vi.useFakeTimers();
    act(() => click(container, "Edit"));
    expect(container.querySelector('[data-detail-preview]')).toBeNull();
    act(() => type(container, "## Updated"));
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("## Updated");
    act(() => vi.advanceTimersByTime(150));
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
