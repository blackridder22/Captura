import { useCallback, useRef } from "react";

/// Returns a function whose identity never changes but always calls the latest
/// `fn`. Lets memoized rows receive handlers without re-rendering on every
/// parent state change.
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}
