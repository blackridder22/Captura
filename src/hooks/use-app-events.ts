import { useEffect } from "react";
import { onCaptured, onFocusComposer, onPermissionRequired } from "../lib/api";
import type { CaptureItem, PermissionRequiredEvent } from "../types";

type AppEventDeps = {
  refresh: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  onCapturedItem: (item: CaptureItem) => void;
  focusComposer: () => void;
  onPermissionRequiredEvent: (event: PermissionRequiredEvent) => void;
};

/// Bootstrap + native event subscriptions. Every dep must be
/// referentially stable or the listeners re-subscribe.
export function useAppEvents({
  refresh,
  refreshPermissions,
  onCapturedItem,
  focusComposer,
  onPermissionRequiredEvent,
}: AppEventDeps) {
  useEffect(() => {
    void refresh();
    void refreshPermissions();

    // NOTE(preserved): if this effect cleans up before the subscription
    // promises settle, the listeners are never detached. Pre-existing
    // behavior; App never unmounts in production.
    let stopCapture: () => void = () => {};
    let stopFocus: () => void = () => {};
    let stopPermission: () => void = () => {};
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
    void onPermissionRequired(onPermissionRequiredEvent).then((off) => {
      stopPermission = off;
    });

    const handleFocus = () => {
      void refresh();
      void refreshPermissions();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      stopCapture();
      stopFocus();
      stopPermission();
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    focusComposer,
    onCapturedItem,
    onPermissionRequiredEvent,
    refresh,
    refreshPermissions,
  ]);
}
