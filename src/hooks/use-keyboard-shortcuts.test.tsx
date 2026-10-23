import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { defaultShortcuts } from "../lib/shortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const actions = { dismissTop: vi.fn(), openSettings: vi.fn(), onEdit: vi.fn(), moveBy: vi.fn(), selectAll: vi.fn(), copySelected: vi.fn(async () => {}), mergeSelected: vi.fn(async () => {}), markSelectedDone: vi.fn(async () => {}), handlePaste: vi.fn(async () => {}), handleDeleteSelected: vi.fn(async () => {}), purgeSelected: vi.fn(async () => {}) };
function Harness({ blocked, inTrash = false }: { blocked: boolean; inTrash?: boolean }) {
  const searchRef = useRef<HTMLInputElement>(null);
  useKeyboardShortcuts({ ...actions, blocked, inTrash, shortcuts: defaultShortcuts, searchRef, selectedId: "capture", selectedIds: ["capture"], selectedItems: [] });
  return <><input ref={searchRef} /><p>Selected document text</p><div className="ProseMirror" contentEditable suppressContentEditableWarning tabIndex={0}>editor</div></>;
}
describe("queue keyboard isolation", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { vi.clearAllMocks(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); window.getSelection()?.removeAllRanges(); });
  it("never performs queue actions behind a menu or overlay", () => {
    act(() => root.render(<Harness blocked />));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });
    expect(actions.copySelected).not.toHaveBeenCalled();
    expect(actions.moveBy).not.toHaveBeenCalled();
    expect(actions.handleDeleteSelected).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(actions.dismissTop).toHaveBeenCalledOnce();
  });
  it("selects all with the shortcut unless a text surface owns the keys", () => {
    act(() => root.render(<Harness blocked={false} />));
    const selectAll = new KeyboardEvent("keydown", { key: "a", code: "KeyA", metaKey: true, bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(selectAll));
    expect(actions.selectAll).toHaveBeenCalledOnce();
    expect(selectAll.defaultPrevented).toBe(true);
    const editor = container.querySelector<HTMLElement>(".ProseMirror")!;
    const inEditor = new KeyboardEvent("keydown", { key: "a", code: "KeyA", metaKey: true, bubbles: true, cancelable: true });
    act(() => { editor.focus(); editor.dispatchEvent(inEditor); });
    expect(actions.selectAll).toHaveBeenCalledOnce();
    expect(inEditor.defaultPrevented).toBe(false);
    const inInput = new KeyboardEvent("keydown", { key: "a", code: "KeyA", metaKey: true, bubbles: true, cancelable: true });
    act(() => { container.querySelector("input")!.focus(); container.querySelector("input")!.dispatchEvent(inInput); });
    expect(actions.selectAll).toHaveBeenCalledOnce();
  });
  it("in Trash, Delete purges and Enter, Space and paste stay inert", () => {
    act(() => root.render(<Harness blocked={false} inTrash />));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", metaKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", metaKey: true, bubbles: true }));
    });
    expect(actions.onEdit).not.toHaveBeenCalled();
    expect(actions.markSelectedDone).not.toHaveBeenCalled();
    expect(actions.handlePaste).not.toHaveBeenCalled();
    expect(actions.handleDeleteSelected).not.toHaveBeenCalled();
    expect(actions.purgeSelected).toHaveBeenCalledOnce();
  });
  it("leaves selected-text copy to the webview", () => {
    act(() => root.render(<Harness blocked={false} />));
    const range = document.createRange(); range.selectNodeContents(container.querySelector("p")!); window.getSelection()?.addRange(range);
    const key = new KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(key));
    expect(actions.copySelected).not.toHaveBeenCalled();
    expect(key.defaultPrevented).toBe(false);
  });
});
