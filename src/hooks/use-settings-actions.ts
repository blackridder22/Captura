import { useCallback } from "react";
import {
  captureClipboardNow,
  requestAccessibility,
  resetShortcuts,
  setKeepOpen,
  setShortcut,
} from "../lib/api";
import type { AppSettings, ShortcutAction } from "../types";
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
    await requestAccessibility();
    await refreshPermissions();
  }, [refreshPermissions]);

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

  return {
    requestAccessibilityAndRefresh,
    changeShortcut,
    resetAllShortcuts,
    changeKeepOpen,
    captureClipboard,
  };
}
