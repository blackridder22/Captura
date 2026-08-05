import { describe, expect, it } from "vitest";
import type { PermissionStatus } from "../types";
import { derivePermissionExperience } from "./permission-state";

const ready: PermissionStatus = {
  accessibilityTrusted: true,
  postEventTrusted: true,
  globalShortcutRegistered: true,
  setupSeen: true,
};

describe("permission experience", () => {
  it.each([
    [null, false, "checking"],
    [{ ...ready, setupSeen: false }, false, "welcome"],
    [
      {
        ...ready,
        setupSeen: false,
        accessibilityTrusted: false,
        postEventTrusted: false,
      },
      false,
      "welcome",
    ],
    [{ ...ready, accessibilityTrusted: false }, false, "repair"],
    [{ ...ready, accessibilityTrusted: false }, true, "limited"],
    [{ ...ready, globalShortcutRegistered: false }, false, "shortcutConflict"],
    [ready, false, "ready"],
  ] as const)("derives %s as %s", (status, limited, expected) => {
    expect(derivePermissionExperience(status, limited)).toBe(expected);
  });

  it("leaves limited mode immediately after permission is restored", () => {
    expect(derivePermissionExperience(ready, true)).toBe("ready");
  });
});
