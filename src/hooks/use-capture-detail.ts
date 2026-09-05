import { useCallback, useEffect, useRef, useState } from "react";
import { getCaptureDetails, onCapturesChanged, updateItem } from "../lib/api";
import type { CaptureDetailRequest, CaptureItem, ItemKind } from "../types";
import { compareCaptureTimestamps } from "../lib/queue-reconciliation";

type DetailIntent = { type: "close" } | { type: "preview" } | { type: "navigate"; index: number } | { type: "request"; request: CaptureDetailRequest };
type DetailState = {
  ids: string[];
  items: Map<string, CaptureItem>;
  index: number;
  base: CaptureItem | null;
  content: string;
  kind: ItemKind;
  mode: "preview" | "edit";
  tab: "source" | "preview";
  loading: boolean;
  saving: boolean;
  error: string;
  pending: DetailIntent | null;
};

const emptyState = (): DetailState => ({ ids: [], items: new Map(), index: 0, base: null, content: "", kind: "note", mode: "preview", tab: "preview", loading: false, saving: false, error: "", pending: null });
export const detailIsDirty = (state: Pick<DetailState, "base" | "content" | "kind">) => Boolean(state.base && (state.content !== state.base.content || state.kind !== state.base.kind));

function selectDetail(state: DetailState, index: number, mode: "preview" | "edit"): DetailState {
  const base = state.items.get(state.ids[index] ?? "") ?? null;
  return { ...state, index, base, content: base?.content ?? "", kind: base?.kind ?? "note", mode, tab: mode === "edit" ? "source" : "preview", loading: false, error: "", pending: null };
}

export function useCaptureDetail(openRequest: CaptureDetailRequest, onClose: () => void) {
  const [state, setState] = useState<DetailState>(() => ({ ...emptyState(), mode: openRequest.mode, loading: true }));
  const closePanel = useRef(onClose);
  closePanel.current = onClose;
  const current = useRef(state);
  const loadSequence = useRef(0);
  const eventRevision = useRef(-1);
  const loadChanges = useRef(new Map<string, CaptureItem | null>());
  const loadIds = useRef(new Set<string>());
  const saveInFlight = useRef(false);
  const commit = useCallback((update: (value: DetailState) => DetailState) => {
    current.current = update(current.current);
    setState(current.current);
  }, []);

  const perform = useCallback(async (intent: DetailIntent) => {
    if (intent.type === "close") {
      loadSequence.current += 1;
      loadChanges.current.clear();
      loadIds.current.clear();
      commit(emptyState);
      closePanel.current();
      return;
    }
    if (intent.type === "navigate" || intent.type === "preview") {
      const index = intent.type === "navigate" ? intent.index : current.current.index;
      commit((value) => selectDetail(value, index, "preview"));
      return;
    }
    const sequence = ++loadSequence.current;
    const ids = [...new Set(intent.request.ids)];
    loadIds.current = new Set(ids);
    loadChanges.current.clear();
    commit((value) => ({ ...value, loading: true, pending: null, error: "" }));
    try {
      const loaded = await getCaptureDetails(ids);
      if (sequence !== loadSequence.current) return;
      const items = new Map(loaded.map((item) => [item.id, item]));
      for (const [id, item] of loadChanges.current) {
        if (!ids.includes(id)) continue;
        if (item) items.set(id, item);
        else items.delete(id);
      }
      commit((value) => selectDetail({ ...value, ids, items }, 0, intent.request.mode));
      loadChanges.current.clear();
      loadIds.current.clear();
    } catch (error) {
      if (sequence === loadSequence.current) commit((value) => ({ ...value, loading: false, error: String(error) }));
    }
  }, [commit]);

  const request = useCallback((intent: DetailIntent) => {
    if (current.current.pending) return;
    if (detailIsDirty(current.current) || saveInFlight.current) {
      commit((value) => ({ ...value, pending: intent }));
    } else void perform(intent);
  }, [commit, perform]);

  const save = useCallback(async (continuePending = false) => {
    const value = current.current;
    if (!value.base || !value.content.trim() || !value.items.has(value.base.id) || saveInFlight.current) return false;
    saveInFlight.current = true;
    commit((next) => ({ ...next, saving: true, error: "" }));
    try {
      const item = await updateItem({ id: value.base.id, content: value.content, kind: value.kind, expectedUpdatedAt: value.base.updatedAt });
      const pending = current.current.pending;
      commit((next) => {
        const received = next.items.get(item.id);
        const latest = received && compareCaptureTimestamps(received.updatedAt, item.updatedAt) > 0 ? received : item;
        return { ...next, items: received ? new Map(next.items).set(item.id, latest) : next.items, base: latest, content: latest.content, kind: latest.kind, saving: false, mode: "preview", tab: "preview", pending: null };
      });
      saveInFlight.current = false;
      if (pending && (continuePending || pending.type !== "preview")) await perform(pending);
      return true;
    } catch (error) {
      commit((next) => ({ ...next, saving: false, error: String(error) }));
      return false;
    } finally { saveInFlight.current = false; }
  }, [commit, perform]);

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    const subscriptions = [
      onCapturesChanged((event) => {
        if (disposed || event.revision <= eventRevision.current) return;
        eventRevision.current = event.revision;
        for (const item of event.upserts) if (loadIds.current.has(item.id)) loadChanges.current.set(item.id, item);
        for (const id of event.deletedIds) if (loadIds.current.has(id)) loadChanges.current.set(id, null);
        commit((value) => {
          const items = new Map(value.items);
          for (const item of event.upserts) if (value.ids.includes(item.id)) items.set(item.id, item);
          for (const id of event.deletedIds) items.delete(id);
          const next = { ...value, items };
          if (value.base && items.has(value.base.id) && !detailIsDirty(value) && !value.saving) {
            const base = items.get(value.base.id)!;
            return { ...next, base, content: base.content, kind: base.kind };
          }
          return next;
        });
      }).then(retain),
    ];
    // Subscribe before loading so edits or deletions during the read are retained.
    void Promise.all(subscriptions).then(() => {
      if (!disposed) request({ type: "request", request: openRequest });
    }).catch((error) => { if (!disposed) commit((value) => ({ ...value, error: String(error) })); });
    return () => { disposed = true; loadSequence.current += 1; stops.forEach((stop) => stop()); };
  }, [commit, request, openRequest]);

  const unavailable = Boolean(!state.loading && state.ids.length && !state.items.has(state.ids[state.index]!));
  return {
    ...state,
    dirty: detailIsDirty(state),
    unavailable,
    conflicted: Boolean(state.base && state.items.get(state.base.id)?.updatedAt !== state.base.updatedAt && !unavailable),
    setContent: (content: string) => commit((value) => ({ ...value, content })),
    setKind: (kind: ItemKind) => commit((value) => ({ ...value, kind })),
    setTab: (tab: "source" | "preview") => commit((value) => ({ ...value, tab })),
    edit: () => commit((value) => ({ ...value, mode: "edit", tab: "source" })),
    close: () => request({ type: "close" }),
    cancelEdit: () => request({ type: "preview" }),
    navigate: (index: number) => request({ type: "navigate", index }),
    cancelPending: () => commit((value) => ({ ...value, pending: null })),
    discardPending: () => { const pending = current.current.pending; if (pending && !saveInFlight.current) { commit((value) => ({ ...value, pending: null })); void perform(pending); } },
    save,
  };
}
