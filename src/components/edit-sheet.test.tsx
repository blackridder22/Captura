import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureItem } from "../types";
import { EditSheet } from "./edit-sheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item: CaptureItem = {
  id: "capture-markdown",
  content: "# Rendered heading\n\n- First\n- Second",
  kind: "note",
  status: "open",
  sourceApp: "Synara",
  sourceBundleId: null,
  sectionId: null,
  attachmentPath: null,
  createdAt: "2026-08-04T17:20:00Z",
  updatedAt: "2026-08-04T17:20:00Z",
};

function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing ${label} button`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("EditSheet Markdown presentation", () => {
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

  it("opens in rendered mode and exposes source only when requested", async () => {
    await act(async () => {
      root.render(
        <EditSheet
          item={item}
          onClose={vi.fn()}
          onSave={vi.fn(async () => undefined)}
        />,
      );
    });

    expect(container.querySelector("h1")?.textContent).toBe("Rendered heading");
    expect(container.querySelector("li")?.textContent).toBe("First");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toContain("# Rendered heading");

    act(() => clickButton(container, "Source"));
    const source = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Markdown source"]',
    );
    expect(source?.value).toBe(item.content);
  });

  it("renders edited source again when returning to Preview", async () => {
    await act(async () => {
      root.render(
        <EditSheet
          item={item}
          onClose={vi.fn()}
          onSave={vi.fn(async () => undefined)}
        />,
      );
    });

    act(() => clickButton(container, "Source"));
    const source = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      valueSetter?.call(source, "## Updated heading\n\n**Bold**");
      source.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => clickButton(container, "Preview"));

    expect(container.querySelector("h2")?.textContent).toBe("Updated heading");
    expect(
      container.querySelector(".edit-rendered-surface strong")?.textContent,
    ).toBe("Bold");
  });
});
