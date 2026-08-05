type SelectionInput = {
  orderedIds: string[];
  selectedIds: string[];
  focusedId: string | null;
  targetId: string;
  toggle: boolean;
};

export type SelectionState = {
  selectedIds: string[];
  focusedId: string | null;
};

export function resolveSelection({
  orderedIds,
  selectedIds,
  focusedId,
  targetId,
  toggle,
}: SelectionInput): SelectionState {
  if (!orderedIds.includes(targetId)) {
    return { selectedIds, focusedId };
  }

  if (toggle) {
    const alreadySelected = selectedIds.includes(targetId);
    const nextSelectedIds = alreadySelected
      ? selectedIds.filter((id) => id !== targetId)
      : orderedIds.filter((id) => [...selectedIds, targetId].includes(id));
    return {
      selectedIds: nextSelectedIds,
      focusedId: targetId,
    };
  }

  return {
    selectedIds: [],
    focusedId: targetId,
  };
}

export function moveSelection({
  orderedIds,
  selectedIds,
  focusedId,
  direction,
  preserveSelection,
}: Omit<SelectionInput, "targetId" | "toggle"> & {
  direction: 1 | -1;
  preserveSelection: boolean;
}): SelectionState {
  if (!orderedIds.length) {
    return { selectedIds: [], focusedId: null };
  }

  const focusedIndex = focusedId ? orderedIds.indexOf(focusedId) : -1;
  const nextIndex =
    focusedIndex < 0
      ? direction === 1
        ? 0
        : orderedIds.length - 1
      : Math.max(0, Math.min(orderedIds.length - 1, focusedIndex + direction));

  return {
    selectedIds: preserveSelection ? selectedIds : [],
    focusedId: orderedIds[nextIndex]!,
  };
}
