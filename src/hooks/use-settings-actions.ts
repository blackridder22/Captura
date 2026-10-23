import { useCallback } from "react";
import {
  captureClipboardNow,
  openAccessibilitySettings,
  requestAccessibility,
  resetShortcuts,
  setDefaultCaptureView,
  setKeepOpen,
  setShortcut,
  setTrashRetention,
} from "../lib/api";
import type { AppSettings, CaptureView, ShortcutAction, TrashRetention } from "../types";
import type { ToastTone } from "./use-notify";

type SettingsActionDeps = {
  setAppSettings: (settings: AppSettings) => void;
  refreshPermissions: () => Promise<void>;
  announce: (text: string) => void;
  notify: (text: string, tone?: ToastTone) => void;
};

export function useSettingsActions({
  setAppSettings,
  refreshPermissions,
  announce,
  notify,
}: SettingsActionDeps) {
  const requestAccessibilityAndRefresh = useCallback(async () => {
    try {
      await requestAccessibility();
      await openAccessibilitySettings();
      await refreshPermissions();
    } catch (error) {
      notify(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not open Accessibility settings.",
        "error",
      );
    }
  }, [notify, refreshPermissions]);

  const changeShortcut = useCallback(
    async (action: ShortcutAction, shortcut: string) => {
      setAppSettings(await setShortcut(action, shortcut));
      if (action === "capture") {
        await refreshPermissions();
      }
      notify("Shortcut updated");
    },
    [notify, refreshPermissions, setAppSettings],
  );

  const resetAllShortcuts = useCallback(async () => {
    try {
      setAppSettings(await resetShortcuts());
      await refreshPermissions();
      notify("Default shortcuts restored");
    } catch (error) {
      notify(
        typeof error === "string"
          ? error
          : "Could not restore default shortcuts.",
        "error",
      );
    }
  }, [notify, refreshPermissions, setAppSettings]);

  const changeKeepOpen = useCallback(
    async (keepOpen: boolean) => {
      setAppSettings(await setKeepOpen(keepOpen));
      announce(
        keepOpen
          ? "Captura will stay open"
          : "Captura will close when you click away",
      );
    },
    [announce, setAppSettings],
  );

  const captureClipboard = useCallback(async () => {
    await captureClipboardNow();
    announce("Clipboard captured");
  }, [announce]);

  const changeTrashRetention = useCallback(
    async (retention: TrashRetention) => {
      try {
        setAppSettings(await setTrashRetention(retention));
        announce(
          retention === "immediate"
            ? "Deleted captures will be removed immediately"
            : `Trash keeps captures for ${retention === "7d" ? "7" : "28"} days`,
        );
      } catch (error) {
        notify(typeof error === "string" ? error : "Could not update the Trash setting.", "error");
      }
    },
    [announce, notify, setAppSettings],
  );

  const changeDefaultCaptureView = useCallback(
    async (view: CaptureView) => {
      try {
        setAppSettings(await setDefaultCaptureView(view));
        announce(view === "page" ? "Captures open as a page" : "Captures open in Source");
      } catch (error) {
        notify(typeof error === "string" ? error : "Could not update the editor setting.", "error");
      }
    },
    [announce, notify, setAppSettings],
  );

  return {
    requestAccessibilityAndRefresh,
    changeShortcut,
    resetAllShortcuts,
    changeKeepOpen,
    changeTrashRetention,
    changeDefaultCaptureView,
    captureClipboard,
  };
}
