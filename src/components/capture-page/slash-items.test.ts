import { describe, expect, it } from "vitest";
import { filterSlashItems, slashItems } from "./slash-items";

describe("slash palette filtering", () => {
  it("returns every block for an empty query, in palette order", () => {
    expect(filterSlashItems(slashItems, "").map((item) => item.id)).toEqual(slashItems.map((item) => item.id));
  });

  it("ranks title prefixes before keyword and description matches", () => {
    expect(filterSlashItems(slashItems, "h").map((item) => item.id)).toEqual(["h1", "h2", "h3", "divider"]);
    expect(filterSlashItems(slashItems, "todo")[0]?.id).toBe("todo");
    expect(filterSlashItems(slashItems, "```")[0]?.id).toBe("code");
    expect(filterSlashItems(slashItems, "ordered")[0]?.id).toBe("numbered");
    expect(filterSlashItems(slashItems, "rule").map((item) => item.id)).toEqual(["divider"]);
  });

  it("is case-insensitive and empty for nonsense", () => {
    expect(filterSlashItems(slashItems, "QUOTE")[0]?.id).toBe("quote");
    expect(filterSlashItems(slashItems, "zzz")).toEqual([]);
  });
});
