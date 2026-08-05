import type { PermissionStatus } from "../types";

export type PermissionExperience =
  | "checking"
  | "welcome"
  | "limited"
  | "repair"
  | "shortcutConflict"
  | "ready";

export function permissionsAreReady(status: PermissionStatus) {
  return status.accessibilityTrusted && status.postEventTrusted;
}

export function derivePermissionExperience(
  status: PermissionStatus | null,
  limitedMode = false,
): PermissionExperience {
  if (!status) return "checking";
  const permissionReady = permissionsAreReady(status);
  if (!status.setupSeen) return "welcome";
  if (!permissionReady) return limitedMode ? "limited" : "repair";
  if (!status.globalShortcutRegistered) return "shortcutConflict";
  return "ready";
}
