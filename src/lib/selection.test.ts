import { describe, expect, it } from "vitest";
import { moveSelection, resolveSelection } from "./selection";

const orderedIds = ["a", "b", "c", "d", "e"];

describe("queue selection", () => {
  it("toggles individual rows with Command without losing prior rows", () => {
    const selected = resolveSelection({
      orderedIds,
      selectedIds: ["b"],
      focusedId: "b",
      anchorId: "b",
      targetId: "d",
      toggle: true,
      range: false,
    });
    expect(selected).toEqual({
      selectedIds: ["b", "d"],
      focusedId: "d",
      anchorId: "d",
    });
  });

  it("keeps a stable anchor across repeated Shift selections", () => {
    const firstRange = resolveSelection({
      orderedIds,
      selectedIds: ["b"],
      focusedId: "b",
      anchorId: "b",
      targetId: "d",
      toggle: false,
      range: true,
    });
    const secondRange = resolveSelection({
      orderedIds,
      ...firstRange,
      targetId: "c",
      toggle: false,
      range: true,
    });
    expect(secondRange).toEqual({
      selectedIds: ["b", "c"],
      focusedId: "c",
      anchorId: "b",
    });
  });

  it("extends keyboard navigation with Shift", () => {
    expect(
      moveSelection({
        orderedIds,
        selectedIds: ["b"],
        focusedId: "b",
        anchorId: "b",
        direction: 1,
        extend: true,
      }),
    ).toEqual({
      selectedIds: ["b", "c"],
      focusedId: "c",
      anchorId: "b",
    });
  });
});
