import { useCallback, useEffect, useRef, useState } from "react";
import {
  markAccessibilitySetupSeen,
  permissionStatus,
  showMainWindow,
} from "../lib/api";
import { derivePermissionExperience } from "../lib/permission-state";
import type { PermissionRequiredEvent, PermissionStatus } from "../types";

export function usePermissions(settingsOpen: boolean) {
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [limitedMode, setLimitedMode] = useState(false);
  const welcomePresented = useRef(false);
  const experience = derivePermissionExperience(permissions, limitedMode);

  const refreshPermissions = useCallback(async () => {
    const next = await permissionStatus();
    setPermissions(next);
    if (next.accessibilityTrusted && next.postEventTrusted) setLimitedMode(false);
  }, []);

  const completeSetup = useCallback(async () => {
    setLimitedMode(false);
    setPermissions(await markAccessibilitySetupSeen());
  }, []);

  const continueInLimitedMode = useCallback(async () => {
    setLimitedMode(true);
    setPermissions(await markAccessibilitySetupSeen());
  }, []);

  const handlePermissionRequired = useCallback(
    (_event: PermissionRequiredEvent) => {
      setLimitedMode(false);
      void refreshPermissions();
    },
    [refreshPermissions],
  );

  useEffect(() => {
    if (experience !== "welcome" || welcomePresented.current) return;
    welcomePresented.current = true;
    void showMainWindow();
  }, [experience]);

  useEffect(() => {
    const shouldPoll =
      settingsOpen ||
      experience === "welcome" ||
      experience === "limited" ||
      experience === "repair" ||
      experience === "shortcutConflict";
    if (!shouldPoll) return;

    void refreshPermissions();
    const verifier = window.setInterval(() => {
      void refreshPermissions();
    }, 750);
    return () => window.clearInterval(verifier);
  }, [experience, refreshPermissions, settingsOpen]);

  return {
    permissions,
    experience,
    refreshPermissions,
    completeSetup,
    continueInLimitedMode,
    handlePermissionRequired,
  };
}
