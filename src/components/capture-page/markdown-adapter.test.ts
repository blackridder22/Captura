import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { loadMarkdown, normalizeMarkdown, pageExtensions, roundTripIsLossy, serializeMarkdown } from "./markdown-adapter";

let editor: Editor;
const create = () => {
  editor = new Editor({ element: document.createElement("div"), extensions: pageExtensions("placeholder"), content: "" });
  return editor;
};
afterEach(() => editor?.destroy());

describe("markdown round trip", () => {
  it("treats cosmetic spelling differences as safe", () => {
    const instance = create();
    for (const source of [
      "# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\n1. first\n2. second",
      "* star bullets\n* are fine",
      "__double__ underscores and _single_ ones",
      "- [ ] open task\n- [x] done task",
      "> a quote\n\n```js\nconst x = 1;\n```\n\n---\n\nAfter the rule.",
      "A [link](https://example.com) and `code`.",
    ]) {
      expect(roundTripIsLossy(instance, source), source).toBe(false);
    }
  });

  it("flags Markdown the page cannot represent", () => {
    const instance = create();
    for (const source of [
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "Inline <kbd>Cmd</kbd> html",
      "![alt text](https://example.com/image.png)",
      "Title\n=====\n\nSetext heading",
    ]) {
      expect(roundTripIsLossy(instance, source), source).toBe(true);
    }
    expect(roundTripIsLossy(instance, "   \n")).toBe(false);
  });

  it("serializes edits back to Markdown and loading never counts as an edit", () => {
    const instance = create();
    let updates = 0;
    instance.on("update", () => { updates += 1; });
    loadMarkdown(instance, "# Heading\n\nBody");
    expect(updates).toBe(0);
    expect(instance.getText()).toContain("Heading");
    instance.chain().focus("end").insertContent(" more").run();
    expect(updates).toBe(1);
    expect(serializeMarkdown(instance)).toBe("# Heading\n\nBody more");
  });

  it("normalizes only for comparison", () => {
    expect(normalizeMarkdown("* a  \r\n+ b\n\n\n\n1) c\n~~~\nx\n~~~\n__b__ _i_")).toBe("- a\n- b\n\n1. c\n```\nx\n```\n**b** *i*");
  });
});
