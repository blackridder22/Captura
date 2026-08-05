import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueueStateControl } from "./queue-state-control";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("QueueStateControl", () => {
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

  it("routes a Shift-click to selection and never toggles Done", async () => {
    const onSelect = vi.fn();
    const onToggleDone = vi.fn();
    await act(async () => {
      root.render(
        <QueueStateControl
          done={false}
          selected={false}
          selectionMode={false}
          onSelect={onSelect}
          onToggleDone={onToggleDone}
        />,
      );
    });

    const button = container.querySelector("button")!;
    act(() =>
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true }),
      ),
    );

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onToggleDone).not.toHaveBeenCalled();
  });

  it("morphs to a checked selection control before the click", async () => {
    await act(async () => {
      root.render(
        <QueueStateControl
          done
          selected
          selectionMode
          onSelect={vi.fn()}
          onToggleDone={vi.fn()}
        />,
      );
    });

    const button = container.querySelector("button")!;
    expect(button.dataset.mode).toBe("selection");
    expect(button.dataset.selected).toBe("true");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Capture selected");
    expect(container.querySelector(".queue-state-selection svg")).not.toBeNull();
  });
});
