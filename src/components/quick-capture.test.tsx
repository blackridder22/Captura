import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_LINE_HEIGHT, COMPOSER_MAX_LINES, COMPOSER_MIN_LINES, composerHeight, QuickCapture } from "./quick-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout; the field reports one line of scroll height per line of text.
const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
beforeAll(() => {
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) { return this.value.split("\n").length * COMPOSER_LINE_HEIGHT; },
  });
});
afterAll(() => {
  delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
  if (original) Object.defineProperty(Element.prototype, "scrollHeight", original);
});

describe("composerHeight", () => {
  it("clamps between the minimum and maximum line counts", () => {
    expect(composerHeight(0)).toBe(COMPOSER_MIN_LINES * COMPOSER_LINE_HEIGHT);
    expect(composerHeight(20)).toBe(40);
    expect(composerHeight(60)).toBe(60);
    expect(composerHeight(61)).toBe(80);
    expect(composerHeight(400)).toBe(COMPOSER_MAX_LINES * COMPOSER_LINE_HEIGHT);
  });
});

describe("QuickCapture", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  const mount = (content: string) => {
    const ref = createRef<HTMLTextAreaElement>();
    act(() => {
      root.render(
        <QuickCapture content={content} kind="note" onContentChange={vi.fn()} onKindChange={vi.fn()} onSubmit={vi.fn()} composerRef={ref} saving={false} saveShortcut="Command+Enter" importingImages={false} imageMenuOpen={false} onAddImage={vi.fn()} />,
      );
    });
    return ref;
  };

  it("grows one line per new line, from two lines up to five, then stops", () => {
    const field = mount("one").current!;
    expect(field.style.height).toBe("40px");
    mount("one\ntwo\nthree");
    expect(field.style.height).toBe("60px");
    mount("1\n2\n3\n4\n5\n6\n7\n8");
    expect(field.style.height).toBe("100px");
    mount("");
    expect(field.style.height).toBe("40px");
  });

  it("marks the active kind tab for the sliding indicator", () => {
    mount("");
    const active = container.querySelector<HTMLButtonElement>('.composer-tabs button[data-active="true"]');
    expect(active?.dataset.indicatorKey).toBe("note");
    expect(container.querySelector(".composer-indicator")).not.toBeNull();
  });
});
