import { version as appVersion } from "../../package.json";
import {
  Check,
  Clipboard,
  DownloadCloud,
  FileCode2,
  Keyboard,
  LockKeyhole,
  LogOut,
  Pin,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { UpdateStatus } from "../hooks/use-updater";
import type {
  AppSettings,
  CaptureView,
  PermissionStatus,
  ShortcutAction,
  TrashRetention,
} from "../types";
import { shortcutActions, shortcutLabel } from "../lib/shortcuts";
import { trashRetentionLabel } from "../lib/items";
import { ShortcutRecorder } from "./shortcut-recorder";
import { Button } from "./ui/button";

type SettingsSheetProps = {
  permissions: PermissionStatus | null;
  settings: AppSettings;
  onClose: () => void;
  onRequestAccessibility: () => Promise<void>;
  onShortcutChange: (
    action: ShortcutAction,
    shortcut: string,
  ) => Promise<void>;
  onResetShortcuts: () => Promise<void>;
  onKeepOpenChange: (keepOpen: boolean) => Promise<void>;
  trashCount: number;
  onTrashRetentionChange: (retention: TrashRetention) => Promise<void>;
  onDefaultCaptureViewChange: (view: CaptureView) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  onCaptureClipboard: () => Promise<void>;
  onQuit: () => Promise<void>;
  updateStatus: UpdateStatus;
  onCheckUpdates: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
};

const retentionOptions: { value: TrashRetention; label: string }[] = [
  { value: "immediate", label: "Now" },
  { value: "7d", label: "7 days" },
  { value: "28d", label: "28 days" },
];

const viewOptions: { value: CaptureView; label: string }[] = [
  { value: "page", label: "Page" },
  { value: "source", label: "Source" },
];

function updateStatusLine(status: UpdateStatus) {
  switch (status.phase) {
    case "checking":
      return "Checking for updates…";
    case "upToDate":
      return "Captura is up to date.";
    case "available":
      return `Version ${status.version} is available.`;
    case "installing":
      return `Installing ${status.version}… Captura will relaunch.`;
    case "error":
      return status.message;
    default:
      return "Updates are checked automatically at launch.";
  }
}

export function SettingsSheet({
  permissions,
  settings,
  onClose,
  onRequestAccessibility,
  onShortcutChange,
  onResetShortcuts,
  onKeepOpenChange,
  trashCount,
  onTrashRetentionChange,
  onDefaultCaptureViewChange,
  onEmptyTrash,
  onCaptureClipboard,
  onQuit,
  updateStatus,
  onCheckUpdates,
  onInstallUpdate,
}: SettingsSheetProps) {
  const permissionsReady =
    Boolean(
      permissions?.accessibilityTrusted && permissions.postEventTrusted,
    );

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
              <p>
                Also available anywhere via{" "}
                {shortcutLabel(settings.shortcuts.captureClipboard)} — copy an
                image or text, press it, captured.
              </p>
            </div>
            <Button
              variant="surface"
              size="sm"
              onClick={() => void onCaptureClipboard()}
            >
              Capture
            </Button>
          </div>

          <div className="settings-group-title">
            <span>Trash</span>
          </div>

          <div className="settings-row">
            <span className="settings-icon">
              <Trash2 size={16} />
            </span>
            <div>
              <strong>Auto-delete</strong>
              <p>{trashRetentionLabel[settings.trashRetention]}</p>
            </div>
            <div className="settings-segmented" role="radiogroup" aria-label="Trash auto-delete">
              {retentionOptions.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={settings.trashRetention === value}
                  data-active={settings.trashRetention === value}
                  onClick={() => void onTrashRetentionChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <span className="settings-icon">
              <Trash2 size={16} />
            </span>
            <div>
              <strong>Empty Trash</strong>
              <p>{trashCount ? `${trashCount} capture${trashCount === 1 ? "" : "s"} waiting to be deleted.` : "Nothing in Trash."}</p>
            </div>
            <Button variant="surface" size="sm" disabled={!trashCount} onClick={() => void onEmptyTrash()}>
              Empty
            </Button>
          </div>

          <div className="settings-group-title">
            <span>Editor</span>
          </div>

          <div className="settings-row">
            <span className="settings-icon">
              <FileCode2 size={16} />
            </span>
            <div>
              <strong>Open captures as</strong>
              <p>Page edits like a document; Source shows the Markdown.</p>
            </div>
            <div className="settings-segmented" role="radiogroup" aria-label="Default capture view">
              {viewOptions.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={settings.defaultCaptureView === value}
                  data-active={settings.defaultCaptureView === value}
                  onClick={() => void onDefaultCaptureViewChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-group-title">
            <span>Permissions and updates</span>
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
                disabled={!permissions}
                onClick={onRequestAccessibility}
              >
                {permissions?.accessibilityTrusted ||
                permissions?.postEventTrusted
                  ? "Finish"
                  : permissions
                    ? "Allow"
                    : "Checking"}
              </Button>
            )}
          </div>

          <div className="settings-row">
            <span className="settings-icon">
              <DownloadCloud size={16} />
            </span>
            <div>
              <strong>Software update</strong>
              <p>{updateStatusLine(updateStatus)}</p>
            </div>
            {updateStatus.phase === "available" ? (
              <Button
                variant="surface"
                size="sm"
                onClick={() => void onInstallUpdate()}
              >
                Install
              </Button>
            ) : (
              <Button
                variant="surface"
                size="sm"
                disabled={
                  updateStatus.phase === "checking" ||
                  updateStatus.phase === "installing"
                }
                onClick={() => void onCheckUpdates()}
              >
                Check
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
          <span>Captura {appVersion}</span>
          <Button variant="ghost" size="sm" onClick={onQuit}>
            <LogOut size={14} />
            Quit Captura
          </Button>
        </footer>
      </section>
    </div>
  );
}
