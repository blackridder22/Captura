type SelectionInput = {
  orderedIds: string[];
  selectedIds: string[];
  focusedId: string | null;
  anchorId: string | null;
  targetId: string;
  toggle: boolean;
  range: boolean;
};

export type SelectionState = {
  selectedIds: string[];
  focusedId: string | null;
  anchorId: string | null;
};

export function resolveSelection({
  orderedIds,
  selectedIds,
  focusedId,
  anchorId,
  targetId,
  toggle,
  range,
}: SelectionInput): SelectionState {
  if (!orderedIds.includes(targetId)) {
    return { selectedIds, focusedId, anchorId };
  }

  if (range) {
    const effectiveAnchor =
      anchorId && orderedIds.includes(anchorId)
        ? anchorId
        : focusedId && orderedIds.includes(focusedId)
          ? focusedId
          : targetId;
    const anchorIndex = orderedIds.indexOf(effectiveAnchor);
    const targetIndex = orderedIds.indexOf(targetId);
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return {
      selectedIds: orderedIds.slice(start, end + 1),
      focusedId: targetId,
      anchorId: effectiveAnchor,
    };
  }

  if (toggle) {
    const alreadySelected = selectedIds.includes(targetId);
    const nextSelectedIds = alreadySelected
      ? selectedIds.filter((id) => id !== targetId)
      : orderedIds.filter((id) => [...selectedIds, targetId].includes(id));
    return {
      selectedIds: nextSelectedIds,
      focusedId: alreadySelected
        ? (nextSelectedIds.at(-1) ?? null)
        : targetId,
      anchorId: targetId,
    };
  }

  return {
    selectedIds: [targetId],
    focusedId: targetId,
    anchorId: targetId,
  };
}

export function moveSelection({
  orderedIds,
  selectedIds,
  focusedId,
  anchorId,
  direction,
  extend,
}: Omit<SelectionInput, "targetId" | "toggle" | "range"> & {
  direction: 1 | -1;
  extend: boolean;
}): SelectionState {
  if (!orderedIds.length) {
    return { selectedIds: [], focusedId: null, anchorId: null };
  }

  const focusedIndex = focusedId ? orderedIds.indexOf(focusedId) : -1;
  const nextIndex =
    focusedIndex < 0
      ? direction === 1
        ? 0
        : orderedIds.length - 1
      : Math.max(0, Math.min(orderedIds.length - 1, focusedIndex + direction));

  return resolveSelection({
    orderedIds,
    selectedIds,
    focusedId,
    anchorId,
    targetId: orderedIds[nextIndex]!,
    toggle: false,
    range: extend,
  });
}
