import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

export type IndicatorMetrics = { x: number; width: number; ready: boolean };

/// Measures the child of `host` carrying `data-indicator-key="<active>"` so one
/// absolutely positioned element can slide between tabs or segments. `ready`
/// is false until the first position is painted, which keeps the initial
/// placement from animating; it follows resizes and content changes (`deps`).
export function useSlidingIndicator(
  host: RefObject<HTMLElement | null>,
  active: string,
  deps: readonly unknown[] = [],
): IndicatorMetrics {
  const [metrics, setMetrics] = useState<IndicatorMetrics>({ x: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const target = element.querySelector<HTMLElement>(`[data-indicator-key="${active}"]`);
      if (!target) {
        setMetrics((current) => (current.width === 0 ? current : { ...current, width: 0 }));
        return;
      }
      const x = target.offsetLeft;
      const width = target.offsetWidth;
      setMetrics((current) => {
        const ready = current.ready || current.width > 0;
        if (current.x === x && current.width === width && current.ready === ready) return current;
        return { x, width, ready };
      });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, active, ...deps]);

  return metrics;
}

/// Inline style for the indicator element: transform for position (cheap to
/// animate), width for size, hidden until something is measured.
export function indicatorStyle(metrics: IndicatorMetrics, inset = 0): CSSProperties {
  const width = Math.max(metrics.width - inset * 2, 0);
  return {
    transform: `translateX(${metrics.x + inset}px)`,
    width: `${width}px`,
    opacity: width ? 1 : 0,
  };
}
