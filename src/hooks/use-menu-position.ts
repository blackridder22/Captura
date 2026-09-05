import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function clampMenuPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return {
    left: Math.max(8, Math.min(x, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(y, viewportHeight - height - 8)),
  };
}

export function useMenuPosition(x: number, y: number, contentKey: string | boolean | number = "", reserveRight = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      const bounds = ref.current.getBoundingClientRect();
      setPosition(clampMenuPosition(x, y, bounds.width, bounds.height, window.innerWidth - reserveRight, window.innerHeight));
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [x, y, contentKey, reserveRight]);
  return { ref, position };
}

export function useMenuFocus(ref: React.RefObject<HTMLDivElement | null>, contentKey: string | boolean | number = "") {
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [ref, contentKey]);
}
