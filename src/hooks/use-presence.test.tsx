import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLastValue, usePresence } from "./use-presence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ open, value }: { open: boolean; value: string | null }) {
  const presence = usePresence(open, 100);
  const shown = useLastValue(value);
  return presence.mounted ? <output data-state={presence.state}>{shown}</output> : <output data-state="unmounted" />;
}

describe("usePresence", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { vi.useFakeTimers(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });
  const state = () => container.querySelector("output")?.dataset.state;

  it("enters over two frames, keeps the last content through the exit, then unmounts", async () => {
    await act(async () => { root.render(<Probe open value="hello" />); });
    expect(state()).toBe("enter");
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    expect(state()).toBe("open");
    await act(async () => { root.render(<Probe open={false} value={null} />); });
    expect(state()).toBe("exit");
    expect(container.textContent).toBe("hello");
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    expect(state()).toBe("exit");
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    expect(state()).toBe("unmounted");
  });

  it("re-opening during an exit cancels the unmount", async () => {
    await act(async () => { root.render(<Probe open value="a" />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    await act(async () => { root.render(<Probe open={false} value={null} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await act(async () => { root.render(<Probe open value="b" />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(state()).toBe("open");
    expect(container.textContent).toBe("b");
  });
});
