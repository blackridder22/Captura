import { useCallback, useEffect, useState } from "react";
import { permissionStatus } from "../lib/api";
import type { PermissionStatus } from "../types";

const initialPermissions: PermissionStatus = {
  accessibilityTrusted: false,
  postEventTrusted: false,
  globalShortcutRegistered: false,
};

export function usePermissions(settingsOpen: boolean) {
  const [permissions, setPermissions] =
    useState<PermissionStatus>(initialPermissions);

  const refreshPermissions = useCallback(async () => {
    setPermissions(await permissionStatus());
  }, []);

  // While settings are open, keep verifying the real macOS state — the user
  // may grant Accessibility in System Settings at any moment.
  useEffect(() => {
    if (!settingsOpen) return;

    void refreshPermissions();
    const verifier = window.setInterval(() => {
      void refreshPermissions();
    }, 750);
    return () => window.clearInterval(verifier);
  }, [refreshPermissions, settingsOpen]);

  return { permissions, refreshPermissions };
}
