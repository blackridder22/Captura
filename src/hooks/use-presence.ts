import { useEffect, useRef, useState } from "react";

export type PresenceState = "enter" | "open" | "exit";

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

/// Keeps an element mounted long enough to play its exit transition.
/// `state` goes "enter" (one frame, the pre-transition style) → "open" →
/// "exit"; `mounted` drops after `exitMs`. Reduced motion skips the wait.
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<PresenceState>(open ? "enter" : "exit");
  const timer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (open) {
      setMounted(true);
      setState("enter");
      // Two frames: the first paints the "enter" style, the second starts the transition.
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => { frame.current = null; setState("open"); });
      });
      return;
    }
    setState("exit");
    const wait = reducedMotion() ? 0 : exitMs;
    timer.current = window.setTimeout(() => { timer.current = null; setMounted(false); }, wait);
  }, [open, exitMs]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  return { mounted, state: open ? state : "exit" };
}

/// Remembers the last non-null value so an exiting element can keep rendering
/// its content after the owner cleared it.
export function useLastValue<T>(value: T | null): T | null {
  const last = useRef<T | null>(value);
  if (value !== null) last.current = value;
  return value ?? last.current;
}
