import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDetailRequest, CaptureItem, CapturesChangedEvent } from "../types";
import * as api from "../lib/api";
import CaptureSheet from "./capture-sheet";
import { defaultShortcuts } from "../lib/shortcuts";
import { AUTOSAVE_DELAY_MS } from "../hooks/use-capture-detail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const onClose = vi.fn();
const onRestore = vi.fn(async () => {});
let nativeChange: (change: CapturesChangedEvent) => void;
vi.mock("../lib/api", () => ({
  getCaptureDetails: vi.fn(), updateItem: vi.fn(),
  copyItems: vi.fn(), attachmentUrl: (value: string) => value,
  onCapturesChanged: vi.fn(async (handler) => { nativeChange = handler; return vi.fn(); }),
}));
// CodeMirror measures layout; the page's Source logic is exercised through a
// textarea stand-in here and the real editor has its own test.
vi.mock("./capture-page/source-editor", () => ({
  SourceEditor: ({ value, onChange, readOnly, ariaLabel }: { value: string; onChange: (value: string) => void; readOnly: boolean; ariaLabel: string }) => (
    <textarea data-source-stub aria-label={ariaLabel} readOnly={readOnly} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
const first: CaptureItem = { id: "first", kind: "note", content: "# First\n\nText", status: "open", sourceApp: null, sourceBundleId: null, sectionId: null, attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null, createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:00:00.000000001Z", deletedAt: null };
const second = { ...first, id: "second", content: "# Second\n\nBody" };

function click(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text || element.getAttribute("aria-label") === text);
  if (!button) throw new Error(`Button missing: ${text}`);
  button.click();
}
function typeInto(field: HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
const sourceField = (container: HTMLElement) => container.querySelector<HTMLTextAreaElement>("[data-source-stub]");
const pageEditor = (container: HTMLElement) => (container.querySelector(".ProseMirror") as TiptapEditorHTMLElement | null)?.editor ?? null;
const status = (container: HTMLElement) => container.querySelector(".capture-save-status")?.textContent;
const settle = async (ms = AUTOSAVE_DELAY_MS + 50) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe("capture page: one Notion-like page with autosave and a Source view", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getCaptureDetails).mockImplementation(async (ids) => ids.map((id) => id === "first" ? first : second));
    vi.mocked(api.updateItem).mockImplementation(async (input) => ({ ...first, ...input, updatedAt: "2026-09-05T10:00:00.000000002Z" }));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });
  const mount = async (request: CaptureDetailRequest = { ids: ["first"], mode: "edit" }, props: Partial<Parameters<typeof CaptureSheet>[0]> = {}) => {
    await act(async () => { root.render(<CaptureSheet request={request} shortcuts={defaultShortcuts} onClose={onClose} onRestore={onRestore} {...props} />); });
    // Tiptap finishes initialising (its "create" event) one timer tick later.
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  };

  it("opens as an editable page and offers the same Markdown in Source", async () => {
    await mount();
    expect(container.querySelector("#capture-sheet-title")?.textContent).toBe("First");
    expect(container.querySelector(".ProseMirror h1")?.textContent).toBe("First");
    expect(container.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("true");
    expect(document.activeElement).toBe(container.querySelector(".ProseMirror"));
    expect(sourceField(container)).toBeNull();
    expect(container.querySelector(".view-switcher .nav-indicator")).not.toBeNull();
    expect(container.querySelector<HTMLElement>('.view-switcher button[data-active="true"]')?.dataset.indicatorKey).toBe("page");
    expect(container.querySelector<HTMLElement>('.sheet-kind-switcher button[data-active="true"]')?.dataset.indicatorKey).toBe("note");
    act(() => click(container, "Source"));
    expect(sourceField(container)?.value).toBe(first.content);
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>('.view-switcher button[data-active="true"]')?.dataset.indicatorKey).toBe("source");
    act(() => click(container, "Page"));
    expect(container.querySelector(".ProseMirror h1")?.textContent).toBe("First");
  });

  it("autosaves page edits as Markdown against the expected version", async () => {
    await mount();
    act(() => { pageEditor(container)!.chain().focus("end").insertContent(" more").run(); });
    expect(status(container)).toBe("Unsaved");
    expect(api.updateItem).not.toHaveBeenCalled();
    await settle();
    expect(api.updateItem).toHaveBeenCalledWith({ id: "first", content: "# First\n\nText more", kind: "note", expectedUpdatedAt: first.updatedAt });
    expect(status(container)).toBe("Saved");
    act(() => { pageEditor(container)!.chain().focus("end").insertContent("!").run(); });
    await settle();
    expect(api.updateItem).toHaveBeenLastCalledWith(expect.objectContaining({ content: "# First\n\nText more!", expectedUpdatedAt: "2026-09-05T10:00:00.000000002Z" }));
  });

  it("preserves every Source character and re-parses the page from it", async () => {
    await mount();
    act(() => click(container, "Source"));
    const draft = "  # Indented\n\nLine with hard break  \n\n";
    act(() => typeInto(sourceField(container)!, draft));
    await settle();
    expect(api.updateItem).toHaveBeenCalledWith({ id: first.id, content: draft, kind: "note", expectedUpdatedAt: first.updatedAt });
    expect(sourceField(container)?.value).toBe(draft);
    act(() => click(container, "Page"));
    expect(container.querySelector(".ProseMirror")?.textContent).toContain("Indented");
  });

  it("flushes a pending draft before closing and keeps the page open when the flush fails", async () => {
    await mount();
    act(() => { pageEditor(container)!.chain().focus("end").insertContent(" draft").run(); });
    vi.mocked(api.updateItem).mockRejectedValueOnce(new Error("Disk full")).mockRejectedValueOnce(new Error("Disk full"));
    await act(async () => { click(container, "Close capture"); await Promise.resolve(); });
    expect(api.updateItem).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Disk full");
    act(() => click(dialog, "Keep editing"));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.querySelector(".ProseMirror")?.textContent).toContain("draft");
    await act(async () => { click(container, "Close capture"); await Promise.resolve(); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { click(container.querySelector('[role="alertdialog"]')!, "Retry"); await Promise.resolve(); });
    expect(api.updateItem).toHaveBeenCalledTimes(3);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("never saves an empty draft and lets Discard close without writing", async () => {
    await mount();
    act(() => { pageEditor(container)!.commands.clearContent(true); });
    await settle();
    expect(api.updateItem).not.toHaveBeenCalled();
    act(() => click(container, "Close capture"));
    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("empty");
    expect([...dialog.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("Retry");
    await act(async () => { click(dialog, "Discard"); await Promise.resolve(); });
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("contains Escape and the save shortcut inside the overlay", async () => {
    await mount();
    const queueKey = vi.fn();
    window.addEventListener("keydown", queueKey);
    const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
    act(() => { pageEditor(container)!.chain().focus("end").insertContent(" typed").run(); });
    await act(async () => { editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", metaKey: true, bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(api.updateItem).toHaveBeenCalledWith(expect.objectContaining({ content: "# First\n\nText typed" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(queueKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", queueKey);
  });

  it("opens Markdown the page cannot keep in Source, with a way back", async () => {
    vi.mocked(api.getCaptureDetails).mockResolvedValueOnce([{ ...first, content: "| a | b |\n|---|---|\n| 1 | 2 |" }]);
    await mount();
    expect(sourceField(container)?.value).toBe("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(container.textContent).toContain("Opened in Source to keep this capture's formatting.");
    expect(api.updateItem).not.toHaveBeenCalled();
    act(() => click(container, "Open as page anyway"));
    expect(container.querySelector(".ProseMirror")).not.toBeNull();
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it("edits an image caption without changing its kind", async () => {
    const image = { ...first, kind: "image" as const, attachmentPath: "/full.png", thumbnailPath: "/thumbnail.png", imageWidth: 4000, imageHeight: 3000 };
    vi.mocked(api.getCaptureDetails).mockResolvedValueOnce([image]);
    vi.mocked(api.updateItem).mockImplementationOnce(async (input) => ({ ...image, ...input, updatedAt: "2026-09-05T10:00:01Z" }));
    await mount();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/full.png");
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    const caption = container.querySelector<HTMLTextAreaElement>(".caption-field")!;
    act(() => typeInto(caption, "New caption"));
    await settle();
    expect(api.updateItem).toHaveBeenCalledWith(expect.objectContaining({ content: "New caption", kind: "image" }));
  });

  it("shows a trashed capture read-only with Restore", async () => {
    vi.mocked(api.getCaptureDetails).mockResolvedValueOnce([{ ...first, deletedAt: "2026-09-06T10:00:00Z" }]);
    await mount();
    expect(container.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("false");
    expect(container.textContent).toContain("This capture is in Trash.");
    act(() => click(container, "Restore"));
    expect(onRestore).toHaveBeenCalledWith("first");
  });

  it("keeps a draft when the capture is deleted or changed elsewhere", async () => {
    await mount();
    act(() => { pageEditor(container)!.chain().focus("end").insertContent(" draft").run(); });
    act(() => nativeChange({ revision: 3, upserts: [{ ...first, content: "remote change", updatedAt: "2026-09-05T10:00:00.000000003Z" }], deletedIds: [] }));
    expect(container.textContent).toContain("This capture changed elsewhere.");
    expect(container.querySelector(".ProseMirror")?.textContent).toContain("draft");
    act(() => nativeChange({ revision: 4, upserts: [], deletedIds: [first.id] }));
    expect(container.textContent).toContain("This capture is no longer available.");
    await settle();
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it("flushes before navigating between captures and keeps their order", async () => {
    await mount({ ids: ["second", "first"], mode: "preview" });
    expect(container.querySelector("#capture-sheet-title")?.textContent).toBe("Second");
    vi.mocked(api.updateItem).mockImplementationOnce(async (input) => ({ ...second, ...input, updatedAt: "2026-09-05T10:00:00.000000005Z" }));
    act(() => { pageEditor(container)!.chain().focus("end").insertContent(" edited").run(); });
    await act(async () => { click(container, "Next capture"); await Promise.resolve(); });
    expect(api.updateItem).toHaveBeenCalledWith(expect.objectContaining({ id: "second", content: "# Second\n\nBody edited" }));
    expect(container.querySelector("#capture-sheet-title")?.textContent).toBe("First");
    expect(container.textContent).toContain("2 of 2");
  });
});
