import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyActionButton } from "./copy-action-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CopyActionButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("shows success only after the clipboard promise resolves, then resets", async () => {
    let resolveCopy!: () => void;
    const onCopy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    await act(async () => {
      root.render(<CopyActionButton kind="note" onCopy={onCopy} />);
    });
    const button = container.querySelector("button")!;

    act(() => button.click());
    expect(container.querySelector(".copy-feedback")?.getAttribute("data-phase")).toBe(
      "copying",
    );
    expect(button.getAttribute("aria-label")).toBe("Copy as Markdown");

    await act(async () => {
      resolveCopy();
      await Promise.resolve();
    });
    expect(container.querySelector(".copy-feedback")?.getAttribute("data-phase")).toBe(
      "copied",
    );
    expect(button.getAttribute("aria-label")).toBe("Copy as Markdown complete");

    act(() => vi.advanceTimersByTime(1199));
    expect(container.querySelector(".copy-feedback")?.getAttribute("data-phase")).toBe(
      "copied",
    );
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector(".copy-feedback")?.getAttribute("data-phase")).toBe(
      "idle",
    );
  });

  it("never displays a false checkmark when copying fails", async () => {
    const onCopy = vi.fn(() => Promise.reject(new Error("clipboard denied")));
    await act(async () => {
      root.render(<CopyActionButton kind="image" onCopy={onCopy} />);
    });
    const button = container.querySelector("button")!;

    await act(async () => button.click());
    expect(container.querySelector(".copy-feedback")?.getAttribute("data-phase")).toBe(
      "idle",
    );
    expect(button.getAttribute("aria-label")).toBe("Copy image");
  });
});
