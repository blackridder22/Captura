import { useCallback, useEffect, useRef, useState } from "react";
import { getCaptureDetails, onCapturesChanged, updateItem } from "../lib/api";
import type { CaptureDetailRequest, CaptureItem, CaptureView, ItemKind } from "../types";
import { compareCaptureTimestamps } from "../lib/queue-reconciliation";

/// Delay between the last edit and the autosave. Short enough to feel like
/// Notion, long enough to coalesce a sentence into one write.
export const AUTOSAVE_DELAY_MS = 600;

type DetailIntent = { type: "close" } | { type: "navigate"; index: number } | { type: "request"; request: CaptureDetailRequest };
type SaveState = "idle" | "saving" | "saved" | "error";
type DetailState = {
  ids: string[];
  items: Map<string, CaptureItem>;
  index: number;
  base: CaptureItem | null;
  content: string;
  kind: ItemKind;
  /// Focus intent from the opener: "edit" places the caret at the end.
  mode: "preview" | "edit";
  view: CaptureView;
  /// Set when Page mode would rewrite this capture's Markdown; opens Source.
  lossy: boolean;
  loading: boolean;
  saving: boolean;
  saveState: SaveState;
  error: string;
  pending: DetailIntent | null;
};

const emptyState = (view: CaptureView): DetailState => ({ ids: [], items: new Map(), index: 0, base: null, content: "", kind: "note", mode: "preview", view, lossy: false, loading: false, saving: false, saveState: "idle", error: "", pending: null });
export const detailIsDirty = (state: Pick<DetailState, "base" | "content" | "kind">) => Boolean(state.base && (state.content !== state.base.content || state.kind !== state.base.kind));

function selectDetail(state: DetailState, index: number, mode: "preview" | "edit", defaultView: CaptureView): DetailState {
  const base = state.items.get(state.ids[index] ?? "") ?? null;
  return { ...state, index, base, content: base?.content ?? "", kind: base?.kind ?? "note", mode, view: defaultView, lossy: false, loading: false, saveState: "idle", error: "", pending: null };
}

/// One Notion-like page per capture: edits autosave, closing or navigating
/// flushes first, and a flush that fails (conflict, empty draft, disk) is the
/// only time a dialog asks what to do.
export function useCaptureDetail(openRequest: CaptureDetailRequest, onClose: () => void, defaultView: CaptureView = "page") {
  const [state, setState] = useState<DetailState>(() => ({ ...emptyState(defaultView), mode: openRequest.mode, loading: true }));
  const closePanel = useRef(onClose);
  closePanel.current = onClose;
  const preferredView = useRef(defaultView);
  preferredView.current = defaultView;
  const current = useRef(state);
  const loadSequence = useRef(0);
  const eventRevision = useRef(-1);
  const loadChanges = useRef(new Map<string, CaptureItem | null>());
  const loadIds = useRef(new Set<string>());
  const saveInFlight = useRef(false);
  const autosaveTimer = useRef<number | null>(null);
  const commit = useCallback((update: (value: DetailState) => DetailState) => {
    current.current = update(current.current);
    setState(current.current);
  }, []);

  const cancelAutosave = useCallback(() => {
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
  }, []);

  const perform = useCallback(async (intent: DetailIntent) => {
    cancelAutosave();
    if (intent.type === "close") {
      loadSequence.current += 1;
      loadChanges.current.clear();
      loadIds.current.clear();
      commit(() => emptyState(preferredView.current));
      closePanel.current();
      return;
    }
    if (intent.type === "navigate") {
      commit((value) => selectDetail(value, intent.index, "preview", preferredView.current));
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
      commit((value) => selectDetail({ ...value, ids, items }, 0, intent.request.mode, preferredView.current));
      loadChanges.current.clear();
      loadIds.current.clear();
    } catch (error) {
      if (sequence === loadSequence.current) commit((value) => ({ ...value, loading: false, error: String(error) }));
    }
  }, [cancelAutosave, commit]);

  /// Persists the draft. Keeps the live draft untouched so keystrokes typed
  /// during the write are never clobbered; only `base` moves forward.
  const save = useCallback(async (continuePending = false) => {
    const value = current.current;
    if (!value.base || !value.content.trim() || !value.items.has(value.base.id) || saveInFlight.current) return false;
    if (!detailIsDirty(value)) return true;
    cancelAutosave();
    saveInFlight.current = true;
    const draft = { content: value.content, kind: value.kind };
    commit((next) => ({ ...next, saving: true, saveState: "saving", error: "" }));
    try {
      const item = await updateItem({ id: value.base.id, content: draft.content, kind: draft.kind, expectedUpdatedAt: value.base.updatedAt });
      const pending = current.current.pending;
      commit((next) => {
        const received = next.items.get(item.id);
        const latest = received && compareCaptureTimestamps(received.updatedAt, item.updatedAt) > 0 ? received : item;
        const items = new Map(next.items).set(item.id, latest);
        return { ...next, items, base: item, saving: false, saveState: "saved", pending: null };
      });
      saveInFlight.current = false;
      if (pending && continuePending) await perform(pending);
      else if (detailIsDirty(current.current)) scheduleAutosaveRef.current();
      return true;
    } catch (error) {
      commit((next) => ({ ...next, saving: false, saveState: "error", error: String(error) }));
      return false;
    } finally { saveInFlight.current = false; }
  }, [cancelAutosave, commit, perform]);

  const scheduleAutosaveRef = useRef<() => void>(() => {});
  const scheduleAutosave = useCallback(() => {
    cancelAutosave();
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      const value = current.current;
      if (value.pending || saveInFlight.current || !detailIsDirty(value) || !value.content.trim()) return;
      void save();
    }, AUTOSAVE_DELAY_MS);
  }, [cancelAutosave, save]);
  scheduleAutosaveRef.current = scheduleAutosave;

  /// Leaving the capture flushes the draft; failure keeps the page open with
  /// a dialog (Retry / Discard / Keep editing).
  const request = useCallback((intent: DetailIntent) => {
    if (current.current.pending) return;
    const value = current.current;
    if (!detailIsDirty(value) && !saveInFlight.current) {
      void perform(intent);
      return;
    }
    commit((next) => ({ ...next, pending: intent }));
    if (value.content.trim()) void save(true);
  }, [commit, perform, save]);

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

  // Unmounting with a pending timer: write the draft rather than losing it.
  useEffect(() => () => {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
      if (detailIsDirty(current.current) && current.current.content.trim()) void save();
    }
  }, [save]);

  const unavailable = Boolean(!state.loading && state.ids.length && !state.items.has(state.ids[state.index]!));
  const trashed = Boolean(state.base && state.items.get(state.base.id)?.deletedAt);
  return {
    ...state,
    dirty: detailIsDirty(state),
    unavailable,
    trashed,
    conflicted: Boolean(state.base && state.items.get(state.base.id)?.updatedAt !== state.base.updatedAt && !unavailable),
    setContent: (content: string) => { commit((value) => ({ ...value, content, saveState: value.saveState === "error" ? "error" : "idle" })); scheduleAutosave(); },
    setKind: (kind: ItemKind) => { commit((value) => ({ ...value, kind })); scheduleAutosave(); },
    setView: (view: CaptureView) => commit((value) => ({ ...value, view })),
    /// Called once per loaded capture by the page, which owns the parser.
    markLossy: (lossy: boolean) => commit((value) => ({ ...value, lossy, view: lossy ? "source" : value.view })),
    flush: () => { cancelAutosave(); return save(); },
    close: () => request({ type: "close" }),
    saveAndClose: () => request({ type: "close" }),
    navigate: (index: number) => request({ type: "navigate", index }),
    cancelPending: () => commit((value) => ({ ...value, pending: null, error: "" })),
    retryPending: () => void save(true),
    discardPending: () => {
      const pending = current.current.pending;
      if (!pending || saveInFlight.current) return;
      cancelAutosave();
      commit((value) => ({ ...value, pending: null, error: "", content: value.base?.content ?? "", kind: value.base?.kind ?? value.kind }));
      void perform(pending);
    },
    save,
  };
}
