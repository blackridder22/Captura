import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureItem } from "../types";
import { QueueItem } from "./queue-item";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item: CaptureItem = {
  id: "capture-1",
  content: "# Markdown heading",
  kind: "note",
  status: "open",
  sourceApp: "Synara",
  sourceBundleId: null,
  attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null,
  sectionId: null,
  createdAt: "2026-08-04T17:20:00Z",
  updatedAt: "2026-08-04T17:20:00Z",
};

describe("QueueItem Shift selection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("prevents WebKit selection and routes the left control to selection", async () => {
    const onSelectionControl = vi.fn();
    const onToggle = vi.fn();
    await act(async () => {
      root.render(
        <QueueItem
          item={item}
          selected={false}
          multiSelected={false}
          selectionMode
          onSelect={vi.fn()}
          onContextMenu={vi.fn()}
          onToggle={onToggle}
          onSelectionControl={onSelectionControl}
          onEdit={vi.fn()}
          onPreview={vi.fn()}
          onDelete={vi.fn()}
          onCopy={vi.fn(async () => undefined)}
          onPaste={vi.fn()}
          pasteShortcut="Meta+Enter"
        />,
      );
    });

    const row = container.querySelector("article")!;
    expect(row.querySelector("h1")?.textContent).toBe("Markdown heading");
    expect(row.textContent).not.toContain("# Markdown heading");
    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });
    act(() => row.dispatchEvent(mouseDown));
    expect(mouseDown.defaultPrevented).toBe(true);

    const control = container.querySelector(".queue-state-control")!;
    act(() => control.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelectionControl).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("loads only the thumbnail in the queue while preview keeps the original capture", async () => {
    const image = { ...item, kind: "image" as const, attachmentPath: "/full-resolution.png", thumbnailPath: "/thumbnail.png", imageWidth: 4000, imageHeight: 3000 };
    const onPreview = vi.fn();
    await act(async () => root.render(<QueueItem item={image} selected={false} multiSelected={false} selectionMode={false} onSelect={vi.fn()} onContextMenu={vi.fn()} onToggle={vi.fn()} onSelectionControl={vi.fn()} onEdit={vi.fn()} onPreview={onPreview} onDelete={vi.fn()} onCopy={vi.fn(async () => {})} onPaste={vi.fn()} pasteShortcut="Meta+Enter" />));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/thumbnail.png");
    act(() => container.querySelector("article")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onPreview).toHaveBeenCalledOnce();
  });
});
