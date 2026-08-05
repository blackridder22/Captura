import { describe, expect, it } from "vitest";
import { moveSelection, resolveSelection } from "./selection";

const orderedIds = ["a", "b", "c", "d", "e"];

describe("queue selection", () => {
  it("toggles only the exact captures clicked", () => {
    const first = resolveSelection({
      orderedIds,
      selectedIds: [],
      focusedId: "b",
      targetId: "a",
      toggle: true,
    });
    const third = resolveSelection({
      orderedIds,
      ...first,
      targetId: "c",
      toggle: true,
    });

    expect(third).toEqual({
      selectedIds: ["a", "c"],
      focusedId: "c",
    });
    expect(third.selectedIds).not.toContain("b");
  });

  it("deselects only the capture clicked again", () => {
    expect(
      resolveSelection({
        orderedIds,
        selectedIds: ["a", "c"],
        focusedId: "c",
        targetId: "a",
        toggle: true,
      }),
    ).toEqual({ selectedIds: ["c"], focusedId: "a" });
  });

  it("plain focus never becomes an implicit bulk selection", () => {
    expect(
      resolveSelection({
        orderedIds,
        selectedIds: ["a", "c"],
        focusedId: "c",
        targetId: "b",
        toggle: false,
      }),
    ).toEqual({ selectedIds: [], focusedId: "b" });
  });

  it("moves focus without extending a range", () => {
    expect(
      moveSelection({
        orderedIds,
        selectedIds: ["a", "c"],
        focusedId: "a",
        direction: 1,
        preserveSelection: true,
      }),
    ).toEqual({
      selectedIds: ["a", "c"],
      focusedId: "b",
    });
  });

  it("normal navigation clears explicit multi-selection", () => {
    expect(
      moveSelection({
        orderedIds,
        selectedIds: ["a", "c"],
        focusedId: "a",
        direction: 1,
        preserveSelection: false,
      }),
    ).toEqual({
      selectedIds: [],
      focusedId: "b",
    });
  });

  it("ignores stale capture ids without changing state", () => {
    expect(
      resolveSelection({
        orderedIds,
        selectedIds: ["a"],
        focusedId: "a",
        targetId: "missing",
        toggle: true,
      }),
    ).toEqual({ selectedIds: ["a"], focusedId: "a" });
  });
});
