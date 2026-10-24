import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOverlays } from "./use-overlays";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../lib/api", () => ({ hideMainWindow: vi.fn(async () => {}) }));

function Probe() {
  const overlays = useOverlays({ hasMultiSelection: false, clearSelection: () => {} });
  return (
    <div>
      <button id="gear" onClick={overlays.openSettings}>Settings</button>
      <output>{overlays.settingsOpen ? "open" : "closed"}</output>
      <button id="dismiss" onClick={overlays.dismissTop}>Dismiss</button>
    </div>
  );
}

describe("useOverlays settings page focus", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { vi.useFakeTimers(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

  it("remembers the control that opened Settings and focuses it again after closing", async () => {
    act(() => { root.render(<Probe />); });
    const gear = container.querySelector<HTMLButtonElement>("#gear")!;
    gear.focus();
    act(() => { gear.click(); });
    expect(container.querySelector("output")?.textContent).toBe("open");
    container.querySelector<HTMLButtonElement>("#dismiss")!.focus();
    act(() => { container.querySelector<HTMLButtonElement>("#dismiss")!.click(); });
    expect(container.querySelector("output")?.textContent).toBe("closed");
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    expect(document.activeElement).toBe(gear);
  });
});
