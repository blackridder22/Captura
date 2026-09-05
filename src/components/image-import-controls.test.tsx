import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickCapture } from "./quick-capture";
import { ImageImportFeedback } from "./image-import-feedback";
import { ImageImportMenu } from "./image-import-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe("image capture controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  it("adds a separate image action without submitting text or intercepting ordinary paste", () => {
    const add = vi.fn(); const submit = vi.fn();
    act(() => root.render(<QuickCapture content="draft" kind="note" onContentChange={vi.fn()} onKindChange={vi.fn()} onSubmit={submit} composerRef={createRef()} saving={false} saveShortcut="Meta+Enter" importingImages={false} imageMenuOpen={false} onAddImage={add} />));
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Add image"]')!;
    act(() => button.click());
    expect(add).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    act(() => container.querySelector("textarea")!.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(false);
  });
  it("offers choose and paste actions in the compact image menu", () => {
    const choose = vi.fn(); const paste = vi.fn();
    act(() => root.render(<ImageImportMenu x={300} y={180} onChoose={choose} onPaste={paste} onClose={vi.fn()} />));
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]');
    expect([...buttons].map((button) => button.textContent)).toEqual(["Choose images…", "Paste image"]);
    act(() => buttons[0]!.click()); act(() => buttons[1]!.click());
    expect(choose).toHaveBeenCalledOnce(); expect(paste).toHaveBeenCalledOnce();
  });
  it("renders individual errors and warnings with their filenames", () => {
    act(() => root.render(<ImageImportFeedback busy={false} onDismiss={vi.fn()} result={{ requestId: "batch", cancelled: false, items: [], issues: [{ index: 0, name: "broken.png", code: "decode", message: "The file is corrupt." }], warnings: [{ index: 1, name: "animated.gif", code: "first_frame", message: "The first frame was captured." }] }} />));
    expect(container.textContent).toContain("broken.png: The file is corrupt.");
    expect(container.textContent).toContain("animated.gif: The first frame was captured.");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
