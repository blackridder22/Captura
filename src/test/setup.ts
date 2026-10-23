// ProseMirror and CodeMirror measure layout; jsdom has no layout engine.
// These shims make mounting and typing work in tests without a browser.
const noRects = () => {
  const list = [] as unknown as DOMRectList;
  Object.defineProperty(list, "item", { value: () => null });
  return list;
};
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= noRects;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
}
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.getClientRects ??= noRects;
}
if (typeof document !== "undefined") {
  document.elementFromPoint ??= () => null;
}
if (typeof window !== "undefined") {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    }) as MediaQueryList;
  (window as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (window as { requestIdleCallback?: unknown }).requestIdleCallback ??= (callback: () => void) => window.setTimeout(callback, 0);
  (window as { cancelIdleCallback?: unknown }).cancelIdleCallback ??= (handle: number) => window.clearTimeout(handle);
}
