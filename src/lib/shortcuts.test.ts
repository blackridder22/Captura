import { describe, expect, it } from "vitest";
import {
  hasModifier,
  matchesShortcut,
  normalizeShortcut,
  shortcutFromEvent,
  shortcutLabel,
} from "./shortcuts";

function keyboardEvent(
  overrides: Partial<
    Pick<
      KeyboardEvent,
      "key" | "code" | "metaKey" | "altKey" | "ctrlKey" | "shiftKey"
    >
  >,
) {
  return {
    key: "",
    code: "",
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("keyboard shortcuts", () => {
  it("records macOS shortcuts in a stable canonical form", () => {
    expect(
      shortcutFromEvent(
        keyboardEvent({
          key: "c",
          code: "KeyC",
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe("Shift+Command+C");
    expect(
      shortcutFromEvent(
        keyboardEvent({ key: " ", code: "Space", altKey: true }),
      ),
    ).toBe("Alt+Space");
  });

  it("normalizes aliases and renders native macOS labels", () => {
    expect(normalizeShortcut("cmd+shift+c")).toBe("Shift+Command+C");
    expect(shortcutLabel("Control+Alt+Shift+Command+Enter")).toBe(
      "⌃⌥⇧⌘↩",
    );
  });

  it("matches exact shortcuts and shift-extended navigation", () => {
    const shiftedArrow = keyboardEvent({
      key: "ArrowDown",
      code: "ArrowDown",
      shiftKey: true,
    });
    expect(matchesShortcut(shiftedArrow, "ArrowDown")).toBe(false);
    expect(matchesShortcut(shiftedArrow, "ArrowDown", true)).toBe(true);
  });

  it("requires a modifier only when the caller asks for one", () => {
    expect(hasModifier("Alt+Space")).toBe(true);
    expect(hasModifier("F8")).toBe(false);
  });
});
