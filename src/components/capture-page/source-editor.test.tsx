import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceEditor } from "./source-editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SourceEditor (CodeMirror glue)", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const view = () => EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;

  it("reports edits, accepts external values, and honors read-only", async () => {
    const onChange = vi.fn();
    const render = (value: string, readOnly = false) => act(() => { root.render(<SourceEditor value={value} readOnly={readOnly} ariaLabel="Markdown source" onChange={onChange} />); });
    await render("# One");
    expect(view().state.doc.toString()).toBe("# One");
    expect(container.querySelector(".cm-content")?.getAttribute("aria-label")).toBe("Markdown source");
    act(() => { view().dispatch({ changes: { from: view().state.doc.length, insert: "\n\n- item  " } }); });
    expect(onChange).toHaveBeenLastCalledWith("# One\n\n- item  ");
    await render("replaced");
    expect(view().state.doc.toString()).toBe("replaced");
    await render("replaced", true);
    expect(view().state.readOnly).toBe(true);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
  });
});
