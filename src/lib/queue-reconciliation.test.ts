import { describe, expect, it } from "vitest";
import { canAcceptSnapshot, compareCaptureTimestamps, reconcileCaptures } from "./queue-reconciliation";
import type { CaptureItem } from "../types";
const item = (id: string, content = id): CaptureItem => ({ id, content, kind: "note", status: "open", attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null, sectionId: null, sourceApp: null, sourceBundleId: null, createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:00:00.000000001Z" });
describe("capture revision reconciliation", () => {
  it("rejects stale snapshot revisions and snapshots started before a local mutation", () => {
    expect(canAcceptSnapshot(3, 4, 2, 2)).toBe(false);
    expect(canAcceptSnapshot(4, 4, 2, 3)).toBe(false);
    expect(canAcceptSnapshot(4, 4, 3, 3)).toBe(true);
  });
  it("updates in place, prepends a batch in supplied order, deletes and deduplicates", () => {
    const updated = { ...item("a"), content: "changed", updatedAt: "2026-09-05T10:00:01Z" };
    const change = { upserts: [item("new-1"), item("new-2"), updated], deletedIds: ["b"] };
    const first = reconcileCaptures([item("a"), item("b"), item("c")], change);
    expect(first.map((row) => row.id)).toEqual(["new-1", "new-2", "a", "c"]);
    expect(first[2]?.content).toBe("changed");
    expect(reconcileCaptures(first, change)).toEqual(first);
    expect(reconcileCaptures(first, change)).toBe(first);
  });
  it("rejects old command replies even when both commits share a millisecond", () => {
    const old = item("a", "old");
    const latest = { ...old, content: "latest", updatedAt: "2026-09-05T10:00:00.000000002Z" };
    expect(Date.parse(old.updatedAt)).toBe(Date.parse(latest.updatedAt));
    expect(compareCaptureTimestamps(old.updatedAt, latest.updatedAt)).toBe(-1);
    expect(reconcileCaptures([latest], { upserts: [old], deletedIds: [] })).toEqual([latest]);
    expect(compareCaptureTimestamps("2026-09-05T10:00:00.100Z", "2026-09-05T12:00:00.100000000+02:00")).toBe(0);
  });
});
