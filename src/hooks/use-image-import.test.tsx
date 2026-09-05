import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import type { CaptureItem, ImageImportInput, ImageImportResult } from "../types";
import { useImageImport } from "./use-image-import";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let completed: (result: ImageImportResult) => void;
let captureError: (message: string) => void;
vi.mock("../lib/api", () => ({
  chooseImageFiles: vi.fn(), pasteImageFromClipboard: vi.fn(),
  onImageImportCompleted: vi.fn(async (handler) => { completed = handler; return vi.fn(); }),
  onCaptureError: vi.fn(async (handler) => { captureError = handler; return vi.fn(); }),
}));
const image: CaptureItem = { id: "image", kind: "image", content: "Photo", status: "open", sourceApp: null, sourceBundleId: null, sectionId: null, attachmentPath: "/full.png", thumbnailPath: "/thumb.png", imageWidth: 1000, imageHeight: 750, createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:00:00Z" };
const batch = (requestId: string, overrides: Partial<ImageImportResult> = {}): ImageImportResult => ({ requestId, cancelled: false, items: [image], issues: [], warnings: [], ...overrides });
const notify = vi.fn();
const success = vi.fn();
let hook: ReturnType<typeof useImageImport>;
function Harness({ section }: { section: string }) { hook = useImageImport({ sectionFilter: section, notify, onSuccess: success }); return <span>{String(hook.busy)}</span>; }

describe("image import requests and result feedback", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { vi.clearAllMocks(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const mount = async (section = "research") => { await act(async () => root.render(<Harness section={section} />)); };

  it("snapshots the section and prevents concurrent UI imports before the first IPC settles", async () => {
    let resolve!: (result: ImageImportResult) => void;
    vi.mocked(api.chooseImageFiles).mockImplementation(() => new Promise((done) => { resolve = done; }));
    await mount();
    let pending!: Promise<void>;
    act(() => { pending = hook.chooseImages(); });
    expect(hook.busy).toBe(true);
    await mount("another-section");
    await act(async () => hook.pasteImage());
    expect(api.pasteImageFromClipboard).not.toHaveBeenCalled();
    expect(api.chooseImageFiles).toHaveBeenCalledWith({ sectionId: "research", requestId: expect.any(String) });
    const input = vi.mocked(api.chooseImageFiles).mock.calls[0]![0];
    await act(async () => { resolve(batch(input.requestId)); await pending; });
    expect(hook.busy).toBe(false);
    expect(success).toHaveBeenCalledOnce();
  });

  it("cancel leaves the previous report unchanged", async () => {
    await mount();
    const previous = batch("external", { warnings: [{ index: 0, name: "animated.gif", code: "first_frame", message: "Only the first frame was captured." }] });
    act(() => completed(previous));
    vi.mocked(api.chooseImageFiles).mockImplementation(async (input) => batch(input.requestId, { cancelled: true, items: [] }));
    success.mockClear();
    await act(async () => hook.chooseImages());
    expect(hook.result).toBe(previous);
    expect(success).not.toHaveBeenCalled();
  });

  it("keeps partial successes, every issue and every warning in one result", async () => {
    const issues = [{ index: 1, name: "broken.png", code: "decode", message: "The image could not be decoded." }];
    const warnings = [{ index: 2, name: "animated.gif", code: "first_frame", message: "Only the first frame was captured." }];
    vi.mocked(api.chooseImageFiles).mockImplementation(async (input) => batch(input.requestId, { issues, warnings }));
    await mount("unfiled");
    await act(async () => hook.chooseImages());
    expect(api.chooseImageFiles).toHaveBeenCalledWith({ requestId: expect.any(String), sectionId: null });
    expect(hook.result).toMatchObject({ items: [image], issues, warnings });
    expect(success).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
  });

  it("handles global clipboard import completion and capture errors", async () => {
    await mount();
    const result = batch("clipboard-request");
    act(() => completed(result));
    expect(hook.result).toBe(result);
    expect(success).toHaveBeenCalledOnce();
    act(() => captureError("Clipboard could not be read."));
    expect(notify).toHaveBeenLastCalledWith("Clipboard could not be read.", "error");
  });

  it("turns command failure into a recoverable report and releases the busy guard", async () => {
    vi.mocked(api.pasteImageFromClipboard).mockRejectedValueOnce(new Error("There is no image on the clipboard."));
    await mount();
    await act(async () => hook.pasteImage());
    expect(hook.busy).toBe(false);
    expect(hook.result?.issues[0]?.message).toBe("There is no image on the clipboard.");
    expect(success).not.toHaveBeenCalled();
  });

  it("detaches subscriptions that finish registering after unmount", async () => {
    let resolve!: (stop: () => void) => void;
    vi.mocked(api.onImageImportCompleted).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await mount();
    act(() => root.render(<></>));
    const stop = vi.fn();
    await act(async () => resolve(stop));
    expect(stop).toHaveBeenCalledOnce();
  });
});
