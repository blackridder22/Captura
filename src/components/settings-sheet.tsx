import {
  Check,
  Clipboard,
  Keyboard,
  LockKeyhole,
  LogOut,
  Pin,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  AppSettings,
  PermissionStatus,
  ShortcutAction,
} from "../types";
import { shortcutActions, shortcutLabel } from "../lib/shortcuts";
import { ShortcutRecorder } from "./shortcut-recorder";
import { Button } from "./ui/button";

type SettingsSheetProps = {
  permissions: PermissionStatus;
  settings: AppSettings;
  onClose: () => void;
  onRequestAccessibility: () => Promise<void>;
  onShortcutChange: (
    action: ShortcutAction,
    shortcut: string,
  ) => Promise<void>;
  onResetShortcuts: () => Promise<void>;
  onKeepOpenChange: (keepOpen: boolean) => Promise<void>;
  onCaptureClipboard: () => Promise<void>;
  onQuit: () => Promise<void>;
};

export function SettingsSheet({
  permissions,
  settings,
  onClose,
  onRequestAccessibility,
  onShortcutChange,
  onResetShortcuts,
  onKeepOpenChange,
  onCaptureClipboard,
  onQuit,
}: SettingsSheetProps) {
  const permissionsReady =
    permissions.accessibilityTrusted && permissions.postEventTrusted;

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section
        className="settings-sheet"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Settings</span>
            <strong>Make Captura work your way.</strong>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </header>

        <div className="settings-scroll">
          <div className="settings-group-title">
            <span>
              <Keyboard size={13} />
              Keyboard shortcuts
            </span>
            <button type="button" onClick={() => void onResetShortcuts()}>
              <RotateCcw size={11} />
              Restore defaults
            </button>
          </div>

          <div className="shortcut-settings">
            {shortcutActions.map(({ action, label, description }) => (
              <div className="shortcut-setting" key={action}>
                <div>
                  <strong>{label}</strong>
                  <p>{description}</p>
                </div>
                <ShortcutRecorder
                  action={action}
                  value={settings.shortcuts[action]}
                  onChange={(shortcut) => onShortcutChange(action, shortcut)}
                />
              </div>
            ))}
          </div>

          <div className="settings-group-title">
            <span>Behavior</span>
          </div>

          <div className="settings-row">
            <span className="settings-icon">
              <Pin size={16} />
            </span>
            <div>
              <strong>Keep Captura open</strong>
              <p>
                Ignore click-away and stay visible until{" "}
                {shortcutLabel(settings.shortcuts.close)} or the × button.
              </p>
            </div>
            <button
              type="button"
              className="settings-switch"
              role="switch"
              aria-checked={settings.keepOpen}
              data-checked={settings.keepOpen}
              onClick={() => void onKeepOpenChange(!settings.keepOpen)}
            >
              <i />
            </button>
          </div>

          <div className="settings-row">
            <span className="settings-icon">
              <Clipboard size={16} />
            </span>
            <div>
              <strong>Capture clipboard</strong>
              <p>Save the current clipboard without using the tray menu.</p>
            </div>
            <Button
              variant="surface"
              size="sm"
              onClick={() => void onCaptureClipboard()}
            >
              Capture
            </Button>
          </div>

          <div className="settings-row">
            <span className="settings-icon">
              <ShieldCheck size={16} />
            </span>
            <div>
              <strong>Accessibility</strong>
              <p>
                Needed only to send Copy and Paste to the app you are using.
              </p>
            </div>
            {permissionsReady ? (
              <span className="permission-ready">
                <Check size={12} />
                Ready
              </span>
            ) : (
              <Button
                variant="surface"
                size="sm"
                onClick={onRequestAccessibility}
              >
                {permissions.accessibilityTrusted ||
                permissions.postEventTrusted
                  ? "Finish"
                  : "Allow"}
              </Button>
            )}
          </div>

          <div className="privacy-note">
            <LockKeyhole size={15} />
            <p>
              Captura stores captures and preferences in a local SQLite
              database. No account, analytics, server, or sync.
            </p>
          </div>
        </div>

        <footer>
          <span>Captura 0.0.1</span>
          <Button variant="ghost" size="sm" onClick={onQuit}>
            <LogOut size={14} />
            Quit Captura
          </Button>
        </footer>
      </section>
    </div>
  );
}
