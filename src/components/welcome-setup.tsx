import { Check, Circle, Keyboard, ShieldCheck } from "lucide-react";
import type { PermissionStatus } from "../types";
import { permissionsAreReady } from "../lib/permission-state";
import { shortcutLabel } from "../lib/shortcuts";
import { Button } from "./ui/button";

type WelcomeSetupProps = {
  permissions: PermissionStatus;
  captureShortcut: string;
  onOpenAccessibility: () => Promise<void>;
  onStart: () => Promise<void>;
  onContinueLimited: () => Promise<void>;
};

export function WelcomeSetup({
  permissions,
  captureShortcut,
  onOpenAccessibility,
  onStart,
  onContinueLimited,
}: WelcomeSetupProps) {
  const permissionReady = permissionsAreReady(permissions);

  return (
    <section className="welcome-setup" aria-labelledby="welcome-title">
      <span className="welcome-eyebrow">Welcome to Captura</span>
      <h1 id="welcome-title">Capture without breaking focus.</h1>
      <p>
        Accessibility lets Captura read selected text and send Copy/Paste to
        the app you are using. Captures stay on this Mac.
      </p>
      <div className="welcome-status-list">
        <div data-ready={permissionReady}>
          <span>{permissionReady ? <Check size={13} /> : <Circle size={13} />}</span>
          <ShieldCheck size={15} />
          <strong>Accessibility</strong>
          <small>{permissionReady ? "Ready" : "Required"}</small>
        </div>
        <div data-ready={permissions.globalShortcutRegistered}>
          <span>
            {permissions.globalShortcutRegistered ? (
              <Check size={13} />
            ) : (
              <Circle size={13} />
            )}
          </span>
          <Keyboard size={15} />
          <strong>Global capture — {shortcutLabel(captureShortcut)}</strong>
          <small>
            {permissions.globalShortcutRegistered ? "Ready" : "Unavailable"}
          </small>
        </div>
      </div>
      <div className="welcome-actions">
        <Button
          variant="accent"
          size="sm"
          onClick={() =>
            void (permissionReady ? onStart() : onOpenAccessibility())
          }
        >
          {permissionReady ? "Start capturing" : "Open Accessibility Settings"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void onContinueLimited()}
        >
          Continue in limited mode
        </Button>
      </div>
    </section>
  );
}
