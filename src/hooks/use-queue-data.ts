import { useCallback, useMemo, useState } from "react";
import { getAppSettings, listItems, listSections } from "../lib/api";
import { defaultShortcuts } from "../lib/shortcuts";
import type { AppSettings, CaptureItem, Section } from "../types";

const initialSettings: AppSettings = {
  shortcuts: { ...defaultShortcuts },
  keepOpen: false,
};

export function useQueueData() {
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings>(initialSettings);

  // Returns the fetched items so the caller can seed selection — selection
  // is owned elsewhere and must not leak into the data layer.
  const refreshData = useCallback(async () => {
    const [nextItems, nextSections, nextSettings] = await Promise.all([
      listItems(),
      listSections(),
      getAppSettings(),
    ]);
    setItems(nextItems);
    setSections(nextSections);
    setAppSettings(nextSettings);
    setLoading(false);
    return nextItems;
  }, []);

  const prependItem = useCallback((item: CaptureItem) => {
    setItems((current) => [item, ...current]);
  }, []);

  const prependDeduped = useCallback((item: CaptureItem) => {
    setItems((current) => [
      item,
      ...current.filter((candidate) => candidate.id !== item.id),
    ]);
  }, []);

  const prependReplacing = useCallback(
    (item: CaptureItem, replacedIds: string[]) => {
      setItems((current) => [
        item,
        ...current.filter((candidate) => !replacedIds.includes(candidate.id)),
      ]);
    },
    [],
  );

  const replaceItem = useCallback((nextItem: CaptureItem) => {
    setItems((current) =>
      current.map((item) => (item.id === nextItem.id ? nextItem : item)),
    );
  }, []);

  const removeItems = useCallback((ids: string[]) => {
    setItems((current) => current.filter((item) => !ids.includes(item.id)));
  }, []);

  const applyUpdatedItems = useCallback((updated: CaptureItem[]) => {
    setItems((current) =>
      current.map(
        (item) => updated.find((candidate) => candidate.id === item.id) ?? item,
      ),
    );
  }, []);

  const addSection = useCallback((section: Section) => {
    setSections((current) => [...current, section]);
  }, []);

  const sectionNames = useMemo(
    () => new Map(sections.map((section) => [section.id, section.name])),
    [sections],
  );

  return {
    items,
    sections,
    loading,
    appSettings,
    setAppSettings,
    refreshData,
    prependItem,
    prependDeduped,
    prependReplacing,
    replaceItem,
    removeItems,
    applyUpdatedItems,
    addSection,
    sectionNames,
  };
}
