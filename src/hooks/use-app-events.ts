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

    let disposed = false;
    let stopCapture: () => void = () => {};
    let stopFocus: () => void = () => {};
    let stopPermission: () => void = () => {};
    void onCaptured((item) => {
      if (!disposed) onCapturedItem(item);
    }).then((off) => {
      if (disposed) off();
      else stopCapture = off;
    });
    void onFocusComposer(() => {
      if (!disposed) focusComposer();
    }).then((off) => {
      if (disposed) off();
      else stopFocus = off;
    });
    void onPermissionRequired((event) => { if (!disposed) onPermissionRequiredEvent(event); }).then((off) => {
      if (disposed) off();
      else stopPermission = off;
    });

    const handleFocus = () => {
      void refresh();
      void refreshPermissions();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      disposed = true;
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
