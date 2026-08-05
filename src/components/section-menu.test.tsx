import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "../types";
import { SectionBar } from "./section-bar";
import { SectionContextMenu } from "./section-context-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function clickButton(container: HTMLElement, text: string, shiftKey = false) {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey }));
}

describe("section deletion interactions", () => {
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

  it("requires confirmation normally and bypasses it with Shift-click", async () => {
    const onAskDelete = vi.fn();
    const onDelete = vi.fn();
    await act(async () => {
      root.render(
        <SectionContextMenu
          x={0}
          y={0}
          name="Research"
          count={3}
          confirmingDelete={false}
          onAskDelete={onAskDelete}
          onCancel={vi.fn()}
          onDelete={onDelete}
        />,
      );
    });

    act(() => clickButton(container, "Delete Section"));
    expect(onAskDelete).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();

    act(() => clickButton(container, "Delete Section", true));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("shows affected captures and lets Cancel leave data untouched", async () => {
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    await act(async () => {
      root.render(
        <SectionContextMenu
          x={0}
          y={0}
          name="Research"
          count={3}
          confirmingDelete
          onAskDelete={vi.fn()}
          onCancel={onCancel}
          onDelete={onDelete}
        />,
      );
    });
    expect(container.textContent).toContain("3 captures will move to Unfiled.");
    act(() => clickButton(container, "Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("exposes a context menu only for custom sections", async () => {
    const section: Section = {
      id: "research",
      name: "Research",
      createdAt: "2026-08-04T00:00:00Z",
    };
    const onContextMenu = vi.fn();
    await act(async () => {
      root.render(
        <SectionBar
          sections={[section]}
          active="all"
          onChange={vi.fn()}
          onCreate={vi.fn()}
          onContextMenu={onContextMenu}
        />,
      );
    });
    const buttons = [...container.querySelectorAll("button")];
    const all = buttons.find((button) => button.textContent === "All")!;
    const research = buttons.find((button) => button.textContent === "Research")!;

    act(() =>
      all.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
    );
    expect(onContextMenu).not.toHaveBeenCalled();
    act(() =>
      research.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
    );
    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(onContextMenu.mock.calls[0]?.[0]).toEqual(section);
  });
});
