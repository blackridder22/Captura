import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onCapturesChanged, snapshotQueue } from "../lib/api";
import { canAcceptSnapshot, reconcileCaptures } from "../lib/queue-reconciliation";
import { defaultShortcuts } from "../lib/shortcuts";
import type { AppSettings, CaptureItem, Section } from "../types";

const initialSettings: AppSettings = { shortcuts: { ...defaultShortcuts }, keepOpen: false, trashRetention: "7d", defaultCaptureView: "page" };

export function useQueueData() {
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings>(initialSettings);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const itemsRef = useRef(items);
  const revision = useRef(-1);
  const mutationEpoch = useRef(0);
  const refreshSequence = useRef(0);
  const listenerReady = useRef<Promise<void>>(Promise.resolve());

  const commit = useCallback((update: (current: CaptureItem[]) => CaptureItem[]) => {
    const next = update(itemsRef.current);
    if (next === itemsRef.current) return;
    mutationEpoch.current += 1;
    itemsRef.current = next;
    setItems(itemsRef.current);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listenerReady.current = onCapturesChanged((event) => {
      if (disposed || event.revision <= revision.current) return;
      revision.current = event.revision;
      commit((current) => reconcileCaptures(current, event));
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => { disposed = true; unlisten(); };
  }, [commit]);

  // A focus refresh may finish after a save/import event. Neither an older
  // native revision nor a refresh started before a local change may overwrite it.
  const refreshData = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    await listenerReady.current;
    // A bounded retry also fills the initial queue if an import commits while
    // the first snapshot is in flight; it must not leave only the new item.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const epoch = mutationEpoch.current;
      const snapshot = await snapshotQueue();
      if (sequence !== refreshSequence.current) return itemsRef.current;
      if (canAcceptSnapshot(snapshot.revision, revision.current, epoch, mutationEpoch.current)) {
        revision.current = snapshot.revision;
        itemsRef.current = snapshot.items;
        setItems(snapshot.items);
        setSections(snapshot.sections);
        setAppSettings(snapshot.settings);
        setStorageWarning(snapshot.storageWarning);
        break;
      }
    }
    setLoading(false);
    return itemsRef.current;
  }, []);

  const prependDeduped = useCallback((item: CaptureItem) => {
    commit((current) => reconcileCaptures(current, { upserts: [item], deletedIds: [] }));
  }, [commit]);
  const prependReplacing = useCallback((item: CaptureItem, replacedIds: string[]) => {
    commit((current) => reconcileCaptures(current, { upserts: [item], deletedIds: replacedIds }));
  }, [commit]);
  // Reply and event both carry the same row; reconcile keeps the array identity
  // when nothing changed, so the second arrival renders nothing.
  const replaceItem = useCallback((nextItem: CaptureItem) => {
    commit((current) => reconcileCaptures(current, { upserts: [nextItem], deletedIds: [] }));
  }, [commit]);
  const removeItems = useCallback((ids: string[]) => {
    commit((current) => reconcileCaptures(current, { upserts: [], deletedIds: ids }));
  }, [commit]);
  const applyUpdatedItems = useCallback((updated: CaptureItem[]) => {
    commit((current) => reconcileCaptures(current, { upserts: updated, deletedIds: [] }));
  }, [commit]);
  const addSection = useCallback((section: Section) => {
    setSections((current) => [...current.filter((candidate) => candidate.id !== section.id), section]);
  }, []);
  const removeSection = useCallback((id: string) => {
    setSections((current) => current.filter((section) => section.id !== id));
  }, []);
  const sectionNames = useMemo(() => new Map(sections.map((section) => [section.id, section.name])), [sections]);

  return { items, sections, loading, appSettings, storageWarning, setAppSettings, refreshData, prependItem: prependDeduped, prependDeduped, prependReplacing, replaceItem, removeItems, applyUpdatedItems, addSection, removeSection, sectionNames };
}
