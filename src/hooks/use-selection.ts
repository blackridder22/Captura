import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { moveSelection, resolveSelection } from "../lib/selection";
import type { CaptureItem } from "../types";

/// Sole owner of the selection triple (focused id, multi-selection, range
/// anchor). The three are always written together; keeping every write in
/// this hook is what makes stable Shift ranges possible.
export function useSelection(visibleItems: CaptureItem[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);

  // Reconcile against the visible list whenever filtering changes it.
  useEffect(() => {
    if (!visibleItems.length) {
      setSelectedId(null);
      setSelectedIds([]);
      selectionAnchorRef.current = null;
      return;
    }
    if (!visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0]!.id);
      setSelectedIds([visibleItems[0]!.id]);
      selectionAnchorRef.current = visibleItems[0]!.id;
      return;
    }
    setSelectedIds((current) => {
      const next = current.filter((id) =>
        visibleItems.some((item) => item.id === id),
      );
      if (
        selectionAnchorRef.current &&
        !visibleItems.some((item) => item.id === selectionAnchorRef.current)
      ) {
        selectionAnchorRef.current = selectedId;
      }
      return next;
    });
  }, [selectedId, visibleItems]);

  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedIds.includes(item.id)),
    [selectedIds, visibleItems],
  );

  const seedIfEmpty = useCallback((firstId: string | null) => {
    setSelectedId((current) => current ?? firstId);
    setSelectedIds((current) =>
      current.length ? current : firstId ? [firstId] : [],
    );
    if (!selectionAnchorRef.current) {
      selectionAnchorRef.current = firstId;
    }
  }, []);

  const setSingle = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedIds([id]);
    selectionAnchorRef.current = id;
  }, []);

  const clear = useCallback(() => {
    setSelectedId(null);
    setSelectedIds([]);
    selectionAnchorRef.current = null;
  }, []);

  const selectWith = useCallback(
    (targetId: string, options: { toggle: boolean; range: boolean }) => {
      const next = resolveSelection({
        orderedIds: visibleItems.map((item) => item.id),
        selectedIds,
        focusedId: selectedId,
        anchorId: selectionAnchorRef.current,
        targetId,
        toggle: options.toggle,
        range: options.range,
      });
      setSelectedId(next.focusedId);
      setSelectedIds(next.selectedIds);
      selectionAnchorRef.current = next.anchorId;
    },
    [selectedId, selectedIds, visibleItems],
  );

  const moveBy = useCallback(
    (direction: 1 | -1, extend: boolean) => {
      const next = moveSelection({
        orderedIds: visibleItems.map((item) => item.id),
        selectedIds,
        focusedId: selectedId,
        anchorId: selectionAnchorRef.current,
        direction,
        extend,
      });
      setSelectedId(next.focusedId);
      setSelectedIds(next.selectedIds);
      selectionAnchorRef.current = next.anchorId;
    },
    [selectedId, selectedIds, visibleItems],
  );

  const isSelected = useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds],
  );

  return {
    selectedId,
    selectedIds,
    selectedItems,
    seedIfEmpty,
    setSingle,
    clear,
    selectWith,
    moveBy,
    isSelected,
  };
}
