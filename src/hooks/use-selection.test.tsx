import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CaptureItem } from "../types";
import { useSelection } from "./use-selection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items: CaptureItem[] = ["first", "middle", "third"].map((id) => ({
  id,
  content: id,
  kind: "note",
  status: "open",
  sourceApp: null,
  sourceBundleId: null,
  attachmentPath: null,
  sectionId: null,
  createdAt: "2026-08-04T17:20:00Z",
  updatedAt: "2026-08-04T17:20:00Z",
}));

function SelectionProbe() {
  const selection = useSelection(items);
  return (
    <div>
      <output
        data-focused={selection.selectedId ?? ""}
        data-selected={selection.selectedIds.join(",")}
        data-actions={selection.actionIds.join(",")}
      />
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => selection.selectWith(item.id, { toggle: true })}
        >
          {item.id}
        </button>
      ))}
    </div>
  );
}

describe("useSelection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<SelectionProbe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("focuses the first row without selecting it", () => {
    const state = container.querySelector("output")!;
    expect(state.dataset.focused).toBe("first");
    expect(state.dataset.selected).toBe("");
    expect(state.dataset.actions).toBe("first");
  });

  it("selects the first and third rows without selecting the middle", () => {
    const buttons = container.querySelectorAll("button");
    act(() => buttons[0]!.click());
    act(() => buttons[2]!.click());

    const state = container.querySelector("output")!;
    expect(state.dataset.selected).toBe("first,third");
    expect(state.dataset.selected).not.toContain("middle");
  });
});
