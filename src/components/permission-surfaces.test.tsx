import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PermissionStatus } from "../types";
import { PermissionBanner } from "./permission-banner";
import { WelcomeSetup } from "./welcome-setup";

const missing: PermissionStatus = {
  accessibilityTrusted: false,
  postEventTrusted: false,
  globalShortcutRegistered: true,
  setupSeen: false,
};

describe("permission surfaces", () => {
  it("explains first-run access and limited mode", () => {
    const html = renderToStaticMarkup(
      <WelcomeSetup
        permissions={missing}
        captureShortcut="Alt+Space"
        onOpenAccessibility={vi.fn()}
        onStart={vi.fn()}
        onContinueLimited={vi.fn()}
      />,
    );
    expect(html).toContain("Welcome to Captura");
    expect(html).toContain("Capture without breaking focus.");
    expect(html).toContain("Captures stay on this Mac.");
    expect(html).toContain("Open Accessibility Settings");
    expect(html).toContain("Continue in limited mode");
    expect(html).toContain("Global capture — ⌥Space");
  });

  it("renders persistent repair and distinct shortcut-conflict guidance", () => {
    const repair = renderToStaticMarkup(
      <PermissionBanner
        experience="repair"
        onOpenAccessibility={vi.fn()}
        onCheckAgain={vi.fn()}
        onOpenShortcutSettings={vi.fn()}
      />,
    );
    expect(repair).toContain(
      "Accessibility is off. Selection capture and paste back are paused.",
    );
    expect(repair).toContain("Check again");

    const conflict = renderToStaticMarkup(
      <PermissionBanner
        experience="shortcutConflict"
        onOpenAccessibility={vi.fn()}
        onCheckAgain={vi.fn()}
        onOpenShortcutSettings={vi.fn()}
      />,
    );
    expect(conflict).toContain("Global capture shortcut is unavailable.");
    expect(conflict).not.toContain("Check again");
  });
});
