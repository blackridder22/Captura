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
  attachmentPath: null,
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
          onDelete={vi.fn()}
          onCopy={vi.fn(async () => undefined)}
          onPaste={vi.fn()}
          pasteShortcut="Meta+Enter"
        />,
      );
    });

    const row = container.querySelector("article")!;
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
});
