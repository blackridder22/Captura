import { useCallback, useEffect, useMemo, useState } from "react";
import { moveSelection, resolveSelection } from "../lib/selection";
import type { CaptureItem } from "../types";

/// Sole owner of queue focus and explicit multi-selection. Focus is never
/// treated as a bulk selection: Shift/Command toggles only the item clicked.
export function useSelection(visibleItems: CaptureItem[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Reconcile against the visible list whenever filtering changes it.
  useEffect(() => {
    if (!visibleItems.length) {
      setSelectedId(null);
      setSelectedIds([]);
      return;
    }
    if (!visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0]!.id);
    }
    setSelectedIds((current) => {
      return current.filter((id) =>
        visibleItems.some((item) => item.id === id),
      );
    });
  }, [selectedId, visibleItems]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedIdSet.has(item.id)),
    [selectedIdSet, visibleItems],
  );

  const actionItems = useMemo(() => {
    if (selectedItems.length) return selectedItems;
    const focused = visibleItems.find((item) => item.id === selectedId);
    return focused ? [focused] : [];
  }, [selectedId, selectedItems, visibleItems]);

  const actionIds = useMemo(
    () => actionItems.map((item) => item.id),
    [actionItems],
  );

  const seedIfEmpty = useCallback((firstId: string | null) => {
    setSelectedId((current) => current ?? firstId);
  }, []);

  const setSingle = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedIds([]);
  }, []);

  const clear = useCallback(() => {
    setSelectedId(null);
    setSelectedIds([]);
  }, []);

  /// Drops the multi-selection but keeps focus where it is (Escape).
  const clearMultiSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  /// ⌘A: every visible capture, focus staying put (or on the first row).
  const selectAll = useCallback(() => {
    if (!visibleItems.length) return;
    setSelectedIds(visibleItems.map((item) => item.id));
    setSelectedId((current) =>
      current && visibleItems.some((item) => item.id === current) ? current : visibleItems[0]!.id,
    );
  }, [visibleItems]);

  const selectWith = useCallback(
    (targetId: string, options: { toggle: boolean }) => {
      const next = resolveSelection({
        orderedIds: visibleItems.map((item) => item.id),
        selectedIds,
        focusedId: selectedId,
        targetId,
        toggle: options.toggle,
      });
      setSelectedId(next.focusedId);
      setSelectedIds(next.selectedIds);
    },
    [selectedId, selectedIds, visibleItems],
  );

  const moveBy = useCallback(
    (direction: 1 | -1, preserveSelection: boolean) => {
      const next = moveSelection({
        orderedIds: visibleItems.map((item) => item.id),
        selectedIds,
        focusedId: selectedId,
        direction,
        preserveSelection,
      });
      setSelectedId(next.focusedId);
      setSelectedIds(next.selectedIds);
    },
    [selectedId, selectedIds, visibleItems],
  );

  const isSelected = useCallback(
    (id: string) => selectedIdSet.has(id),
    [selectedIdSet],
  );

  return {
    selectedId,
    selectedIds,
    selectedIdSet,
    selectedItems,
    actionIds,
    actionItems,
    seedIfEmpty,
    setSingle,
    clear,
    clearMultiSelection,
    selectAll,
    selectWith,
    moveBy,
    isSelected,
  };
}
