import { describe, expect, it } from "vitest";
import { markdownExcerpt } from "./items";
import { clampMenuPosition } from "../hooks/use-menu-position";
describe("bounded queue excerpts", () => {
  it("keeps Unicode code points intact and does not alter short Markdown", () => {
    const source = "  # Heading  \n\n";
    expect(markdownExcerpt(source)).toBe(source);
    const large = "a".repeat(1023) + "🧭" + "b".repeat(10000);
    expect(markdownExcerpt(large)).toBe("a".repeat(1023) + "🧭");
    expect([...markdownExcerpt(large)]).toHaveLength(1024);
  });
});
describe("compact menu bounds", () => {
  it("keeps measured menus inside the eight-pixel gutter in either panel height", () => {
    expect(clampMenuPosition(425, 649, 168, 38, 430, 650)).toEqual({ left: 254, top: 604 });
    expect(clampMenuPosition(425, 519, 200, 104, 430, 520)).toEqual({ left: 222, top: 408 });
    expect(clampMenuPosition(-5, -5, 200, 104, 430, 520)).toEqual({ left: 8, top: 8 });
  });
});
