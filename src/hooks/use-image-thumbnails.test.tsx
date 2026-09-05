import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureImageThumbnail } from "../lib/api";
import type { CaptureItem } from "../types";
import { useImageThumbnails } from "./use-image-thumbnails";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../lib/api", () => ({ isTauriRuntime: () => true, ensureImageThumbnail: vi.fn() }));
const original: CaptureItem = { id: "legacy", kind: "image", content: "Legacy image", status: "open", sourceApp: null, sourceBundleId: null, sectionId: null, attachmentPath: "/original.png", thumbnailPath: null, imageWidth: null, imageHeight: null, createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:00:00Z" };
const ready = vi.fn();
let intersection: IntersectionObserverCallback;
class Observer {
  constructor(callback: IntersectionObserverCallback) { intersection = callback; }
  observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
}
function Harness({ items }: { items: CaptureItem[] }) {
  const ref = useRef<HTMLElement>(null);
  const failed = useImageThumbnails(ref, items, ready);
  return <section ref={ref}>{items.map((item) => <figure key={item.id} data-thumbnail-id={item.id}>{failed.has(item.id) ? "unavailable" : "image"}</figure>)}</section>;
}
function reveal(element: Element) { intersection([{ target: element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); }

describe("visible legacy image thumbnails", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("IntersectionObserver", Observer); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  it("waits for visibility and makes one native request per missing thumbnail", async () => {
    let resolve!: (item: CaptureItem) => void;
    vi.mocked(ensureImageThumbnail).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await act(async () => root.render(<Harness items={[original]} />));
    expect(ensureImageThumbnail).not.toHaveBeenCalled();
    act(() => { reveal(container.querySelector("figure")!); reveal(container.querySelector("figure")!); });
    expect(ensureImageThumbnail).toHaveBeenCalledTimes(1);
    const thumbnail = { ...original, thumbnailPath: "/thumbnail.png", imageWidth: 2400, imageHeight: 1800 };
    await act(async () => resolve(thumbnail));
    expect(ready).toHaveBeenCalledWith([thumbnail]);
    await act(async () => root.render(<Harness items={[original]} />));
    act(() => reveal(container.querySelector("figure")!));
    expect(ensureImageThumbnail).toHaveBeenCalledTimes(1);
  });
  it("processes visible legacy thumbnails serially", async () => {
    const resolvers: ((item: CaptureItem) => void)[] = [];
    vi.mocked(ensureImageThumbnail).mockImplementation(() => new Promise((done) => { resolvers.push(done); }));
    const second = { ...original, id: "second" };
    await act(async () => root.render(<Harness items={[original, second]} />));
    act(() => { for (const row of container.querySelectorAll("figure")) reveal(row); });
    expect(ensureImageThumbnail).toHaveBeenCalledTimes(1);
    await act(async () => resolvers[0]!({ ...original, thumbnailPath: "/one.png" }));
    expect(ensureImageThumbnail).toHaveBeenCalledTimes(2);
    expect(ensureImageThumbnail).toHaveBeenNthCalledWith(2, "second");
    await act(async () => resolvers[1]!({ ...second, thumbnailPath: "/two.png" }));
  });
  it("does not retry a corrupt legacy image on every render", async () => {
    vi.mocked(ensureImageThumbnail).mockRejectedValueOnce(new Error("Missing file"));
    await act(async () => root.render(<Harness items={[original]} />));
    await act(async () => reveal(container.querySelector("figure")!));
    expect(container.textContent).toBe("unavailable");
    await act(async () => root.render(<Harness items={[original]} />));
    act(() => reveal(container.querySelector("figure")!));
    expect(ensureImageThumbnail).toHaveBeenCalledTimes(1);
  });
});
