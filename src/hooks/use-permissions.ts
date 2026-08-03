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
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const refreshPermissions = useCallback(async () => {
    setPermissions(await permissionStatus());
  }, []);

  const permissionsReady =
    permissions.accessibilityTrusted && permissions.postEventTrusted;

  // Keep verifying the real macOS state while it matters: fast while the
  // settings sheet is open, slower while the onboarding banner is up — the
  // user may grant Accessibility in System Settings at any moment.
  useEffect(() => {
    if (!settingsOpen && permissionsReady) return;

    void refreshPermissions();
    const verifier = window.setInterval(
      () => {
        void refreshPermissions();
      },
      settingsOpen ? 750 : 2000,
    );
    return () => window.clearInterval(verifier);
  }, [permissionsReady, refreshPermissions, settingsOpen]);

  const dismissOnboarding = useCallback(() => setOnboardingDismissed(true), []);

  return {
    permissions,
    refreshPermissions,
    showOnboarding: !permissionsReady && !onboardingDismissed,
    dismissOnboarding,
  };
}
