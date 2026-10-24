import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useRef } from "react";
import { indicatorStyle, useSlidingIndicator } from "./use-sliding-indicator";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout: tabs declare their geometry through data attributes.
const offsets = {
  offsetLeft: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetLeft"),
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
};
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetLeft", { configurable: true, get(this: HTMLElement) { return Number(this.dataset.x ?? 0); } });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) { return Number(this.dataset.w ?? 0); } });
});
afterAll(() => {
  if (offsets.offsetLeft) Object.defineProperty(HTMLElement.prototype, "offsetLeft", offsets.offsetLeft);
  if (offsets.offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsets.offsetWidth);
});

function Tabs({ active }: { active: string }) {
  const host = useRef<HTMLDivElement>(null);
  const metrics = useSlidingIndicator(host, active);
  return (
    <div ref={host}>
      <button data-indicator-key="a" data-x="10" data-w="40" />
      <button data-indicator-key="b" data-x="70" data-w="52" />
      <i data-ready={metrics.ready} style={indicatorStyle(metrics, 2)} />
    </div>
  );
}

describe("useSlidingIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const indicator = () => container.querySelector("i")!;

  it("measures the active tab, animates only after the first placement, and hides without a match", () => {
    act(() => { root.render(<Tabs active="a" />); });
    expect(indicator().style.transform).toBe("translateX(12px)");
    expect(indicator().style.width).toBe("36px");
    expect(indicator().style.opacity).toBe("1");
    expect(indicator().dataset.ready).toBe("false");

    act(() => { root.render(<Tabs active="b" />); });
    expect(indicator().style.transform).toBe("translateX(72px)");
    expect(indicator().style.width).toBe("48px");
    expect(indicator().dataset.ready).toBe("true");

    act(() => { root.render(<Tabs active="missing" />); });
    expect(indicator().style.opacity).toBe("0");
  });
});
