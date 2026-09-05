import { useEffect, useRef, useState, type RefObject } from "react";
import { ensureImageThumbnail, isTauriRuntime } from "../lib/api";
import type { CaptureItem } from "../types";

export function useImageThumbnails(listRef: RefObject<HTMLElement | null>, items: CaptureItem[], onReady: (items: CaptureItem[]) => void) {
  const attempted = useRef(new Set<string>());
  const waiting = useRef<string[]>([]);
  const running = useRef(false);
  const mounted = useRef(true);
  const ready = useRef(onReady);
  ready.current = onReady;
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; waiting.current = []; }; }, []);
  useEffect(() => {
    if (!isTauriRuntime() || !listRef.current) return;
    const missing = new Set(items.filter((item) => item.kind === "image" && item.attachmentPath && !item.thumbnailPath).map((item) => item.id));
    const drain = async () => {
      if (running.current) return;
      running.current = true;
      while (mounted.current && waiting.current.length) {
        const id = waiting.current.shift()!;
        try {
          const item = await ensureImageThumbnail(id);
          if (mounted.current) ready.current([item]);
        } catch {
          if (mounted.current) setFailed((current) => new Set(current).add(id));
        }
      }
      running.current = false;
    };
    const request = (element: Element) => {
      const id = (element as HTMLElement).dataset.thumbnailId;
      if (!id || !missing.has(id) || attempted.current.has(id)) return;
      attempted.current.add(id);
      waiting.current.push(id);
      void drain();
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { request(entry.target); observer?.unobserve(entry.target); }
    }, { root: listRef.current, threshold: 0 });
    for (const element of listRef.current.querySelectorAll("[data-thumbnail-id]")) {
      if (observer) observer.observe(element);
      else {
        const row = element.getBoundingClientRect();
        const bounds = listRef.current.getBoundingClientRect();
        if (row.bottom > bounds.top && row.top < bounds.bottom) request(element);
      }
    }
    return () => observer?.disconnect();
  }, [items, listRef]);
  return failed;
}
