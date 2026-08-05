import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useShiftSelectionMode } from "./use-shift-selection-mode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ShiftModeProbe() {
  return <output>{useShiftSelectionMode() ? "selecting" : "idle"}</output>;
}

describe("useShiftSelectionMode", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<ShiftModeProbe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("enters on Shift key-down and exits on key-up", () => {
    expect(container.textContent).toBe("idle");
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Shift", bubbles: true }),
      ),
    );
    expect(container.textContent).toBe("selecting");

    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keyup", { key: "Shift", bubbles: true }),
      ),
    );
    expect(container.textContent).toBe("idle");
  });

  it("resets if the window loses focus before key-up", () => {
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" })),
    );
    expect(container.textContent).toBe("selecting");

    act(() => window.dispatchEvent(new Event("blur")));
    expect(container.textContent).toBe("idle");
  });
});
