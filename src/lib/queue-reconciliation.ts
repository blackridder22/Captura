import type { CaptureItem, CapturesChangedEvent } from "../types";

export function compareCaptureTimestamps(left: string, right: string): number {
  const milliseconds = Date.parse(left) - Date.parse(right);
  if (milliseconds) return Math.sign(milliseconds);
  // Rust timestamps retain nanoseconds; Date.parse alone erases the ordering
  // of two commits within one millisecond.
  const fractional = (value: string) => (value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "").padEnd(9, "0").slice(0, 9);
  const a = fractional(left);
  const b = fractional(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function reconcileCaptures(items: CaptureItem[], change: Pick<CapturesChangedEvent, "upserts" | "deletedIds">) {
  const deleted = new Set(change.deletedIds);
  const updates = new Map(change.upserts.map((item) => [item.id, item]));
  const existing = new Set(items.map((item) => item.id));
  const added = change.upserts.filter((item) => !existing.has(item.id) && !deleted.has(item.id));
  return [
    ...added,
    ...items.filter((item) => !deleted.has(item.id)).map((item) => {
      const update = updates.get(item.id);
      return update && compareCaptureTimestamps(update.updatedAt, item.updatedAt) >= 0 ? update : item;
    }),
  ];
}

export function canAcceptSnapshot(snapshotRevision: number, currentRevision: number, startedEpoch: number, currentEpoch: number) {
  return snapshotRevision >= currentRevision && startedEpoch === currentEpoch;
}
