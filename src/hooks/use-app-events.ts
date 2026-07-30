import { useEffect } from "react";
import { onCaptured, onFocusComposer } from "../lib/api";
import type { CaptureItem } from "../types";

type AppEventDeps = {
  refresh: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  onCapturedItem: (item: CaptureItem) => void;
  focusComposer: () => void;
};

/// Bootstrap + native event subscriptions. Every dep must be
/// referentially stable or the listeners re-subscribe.
export function useAppEvents({
  refresh,
  refreshPermissions,
  onCapturedItem,
  focusComposer,
}: AppEventDeps) {
  useEffect(() => {
    void refresh();
    void refreshPermissions();

    // NOTE(preserved): if this effect cleans up before the subscription
    // promises settle, the listeners are never detached. Pre-existing
    // behavior; App never unmounts in production.
    let stopCapture: () => void = () => {};
    let stopFocus: () => void = () => {};
    void onCaptured((item) => {
      onCapturedItem(item);
    }).then((off) => {
      stopCapture = off;
    });
    void onFocusComposer(() => {
      focusComposer();
    }).then((off) => {
      stopFocus = off;
    });

    const handleFocus = () => {
      void refresh();
      void refreshPermissions();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      stopCapture();
      stopFocus();
      window.removeEventListener("focus", handleFocus);
    };
  }, [focusComposer, onCapturedItem, refresh, refreshPermissions]);
}
