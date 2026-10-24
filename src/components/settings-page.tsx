import { version as appVersion } from "../../package.json";
import {
  Check,
  Clipboard,
  DownloadCloud,
  FileCode2,
  Info,
  Keyboard,
  LockKeyhole,
  LogOut,
  Pin,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PresenceState } from "../hooks/use-presence";
import { indicatorStyle, useSlidingIndicator } from "../hooks/use-sliding-indicator";
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

type SettingsSection = "general" | "shortcuts" | "editor" | "trash" | "about";

type SettingsPageProps = {
  permissions: PermissionStatus | null;
  settings: AppSettings;
  trashCount: number;
  presenceState?: PresenceState;
  onClose: () => void;
  onRequestAccessibility: () => Promise<void>;
  onShortcutChange: (action: ShortcutAction, shortcut: string) => Promise<void>;
  onResetShortcuts: () => Promise<void>;
  onKeepOpenChange: (keepOpen: boolean) => Promise<void>;
  onTrashRetentionChange: (retention: TrashRetention) => Promise<void>;
  onDefaultCaptureViewChange: (view: CaptureView) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  onCaptureClipboard: () => Promise<void>;
  onQuit: () => Promise<void>;
  updateStatus: UpdateStatus;
  onCheckUpdates: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
};

const sections: { id: SettingsSection; label: string; icon: typeof Keyboard }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "editor", label: "Editor", icon: FileCode2 },
  { id: "trash", label: "Trash", icon: Trash2 },
  { id: "about", label: "About", icon: Info },
];

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

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const indicator = useSlidingIndicator(host, value);
  return (
    <div ref={host} className="settings-segmented" role="radiogroup" aria-label={label}>
      <span className="nav-indicator" aria-hidden="true" data-ready={indicator.ready} style={indicatorStyle(indicator)} />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          data-active={value === option.value}
          data-indicator-key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const sectionIndex = (id: SettingsSection) => sections.findIndex((section) => section.id === id);

/// Settings is a full page over the queue (no modal card): header, section
/// tabs with a sliding highlight, a scrolling body whose section slides in the
/// direction of travel, and a footer with the version and Quit.
export function SettingsPage({
  permissions,
  settings,
  trashCount,
  presenceState,
  onClose,
  onRequestAccessibility,
  onShortcutChange,
  onResetShortcuts,
  onKeepOpenChange,
  onTrashRetentionChange,
  onDefaultCaptureViewChange,
  onEmptyTrash,
  onCaptureClipboard,
  onQuit,
  updateStatus,
  onCheckUpdates,
  onInstallUpdate,
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>("general");
  const [direction, setDirection] = useState<"none" | "forward" | "back">("none");
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const permissionsReady = Boolean(permissions?.accessibilityTrusted && permissions.postEventTrusted);
  const page = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const indicator = useSlidingIndicator(nav, section);

  // The queue behind is inert, so the page itself takes focus; Escape and
  // Tab then work from here without a visible ring on a mouse open.
  useEffect(() => { page.current?.focus({ preventScroll: true }); }, []);

  const switchSection = (next: SettingsSection) => {
    if (next === section) return;
    setDirection(sectionIndex(next) > sectionIndex(section) ? "forward" : "back");
    setSection(next);
  };

  return (
    <section
      ref={page}
      className="panel-page settings-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      data-state={presenceState}
      tabIndex={-1}
    >
        <header className="page-header">
          <div>
            <span>Settings</span>
            <strong id="settings-title">Make Captura work your way.</strong>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close settings" title="Close settings (Esc)" onClick={onClose}>
            <X size={16} />
          </Button>
        </header>

        <nav ref={nav} className="settings-nav" role="tablist" aria-label="Settings sections">
          <span className="nav-indicator" aria-hidden="true" data-ready={indicator.ready} style={indicatorStyle(indicator)} />
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              data-active={section === id}
              data-indicator-key={id}
              onClick={() => switchSection(id)}
            >
              <Icon size={13} strokeWidth={1.9} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-scroll page-body" role="tabpanel">
          <div className="settings-section" key={section} data-direction={direction}>
            {section === "general" ? (
              <>
                <div className="settings-row">
                  <span className="settings-icon"><Pin size={16} /></span>
                  <div>
                    <strong>Keep Captura open</strong>
                    <p>Ignore click-away and stay visible until {shortcutLabel(settings.shortcuts.close)} or the × button.</p>
                  </div>
                  <button
                    type="button"
                    className="settings-switch"
                    role="switch"
                    aria-label="Keep Captura open"
                    aria-checked={settings.keepOpen}
                    data-checked={settings.keepOpen}
                    onClick={() => void onKeepOpenChange(!settings.keepOpen)}
                  >
                    <i />
                  </button>
                </div>

                <div className="settings-row">
                  <span className="settings-icon"><Clipboard size={16} /></span>
                  <div>
                    <strong>Capture clipboard</strong>
                    <p>Also available anywhere via {shortcutLabel(settings.shortcuts.captureClipboard)}. Copy an image or text, press it, captured.</p>
                  </div>
                  <Button variant="surface" size="sm" onClick={() => void onCaptureClipboard()}>Capture</Button>
                </div>

                <div className="settings-row">
                  <span className="settings-icon"><ShieldCheck size={16} /></span>
                  <div>
                    <strong>Accessibility</strong>
                    <p>Needed only to send Copy and Paste to the app you are using.</p>
                  </div>
                  {permissionsReady ? (
                    <span className="permission-ready"><Check size={12} />Ready</span>
                  ) : (
                    <Button variant="surface" size="sm" disabled={!permissions} onClick={onRequestAccessibility}>
                      {permissions?.accessibilityTrusted || permissions?.postEventTrusted ? "Finish" : permissions ? "Allow" : "Checking"}
                    </Button>
                  )}
                </div>
              </>
            ) : null}

            {section === "shortcuts" ? (
              <>
                <div className="settings-group-title">
                  <span>Every shortcut can be rebound</span>
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
              </>
            ) : null}

            {section === "editor" ? (
              <>
                <div className="settings-row">
                  <span className="settings-icon"><FileCode2 size={16} /></span>
                  <div>
                    <strong>Open captures as</strong>
                    <p>Page edits like a document, with / for blocks. Source shows the Markdown.</p>
                  </div>
                  <Segmented label="Default capture view" value={settings.defaultCaptureView} options={viewOptions} onChange={(view) => void onDefaultCaptureViewChange(view)} />
                </div>
                <p className="settings-hint">Captures with tables or raw HTML open in Source so their formatting is kept. Edits save automatically.</p>
              </>
            ) : null}

            {section === "trash" ? (
              <>
                <div className="settings-row">
                  <span className="settings-icon"><Trash2 size={16} /></span>
                  <div>
                    <strong>Auto-delete</strong>
                    <p>{trashRetentionLabel[settings.trashRetention]}</p>
                  </div>
                  <Segmented label="Trash auto-delete" value={settings.trashRetention} options={retentionOptions} onChange={(retention) => void onTrashRetentionChange(retention)} />
                </div>
                <div className="settings-row">
                  <span className="settings-icon"><Trash2 size={16} /></span>
                  <div>
                    <strong>Empty Trash</strong>
                    <p>{trashCount ? `${trashCount} capture${trashCount === 1 ? "" : "s"} waiting to be deleted.` : "Nothing in Trash."}</p>
                  </div>
                  {confirmingEmpty ? (
                    <span className="settings-inline-actions">
                      <Button variant="ghost" size="sm" onClick={() => setConfirmingEmpty(false)}>Cancel</Button>
                      <Button variant="danger" size="sm" onClick={() => { setConfirmingEmpty(false); void onEmptyTrash(); }}>Delete all</Button>
                    </span>
                  ) : (
                    <Button variant="surface" size="sm" disabled={!trashCount} onClick={() => setConfirmingEmpty(true)}>Empty</Button>
                  )}
                </div>
                <p className="settings-hint">Merged captures also move to Trash, so a merge can be undone. "Now" skips Trash entirely.</p>
              </>
            ) : null}

            {section === "about" ? (
              <>
                <div className="settings-row">
                  <span className="settings-icon"><DownloadCloud size={16} /></span>
                  <div>
                    <strong>Software update</strong>
                    <p>{updateStatusLine(updateStatus)}</p>
                  </div>
                  {updateStatus.phase === "available" ? (
                    <Button variant="surface" size="sm" onClick={() => void onInstallUpdate()}>Install</Button>
                  ) : (
                    <Button variant="surface" size="sm" disabled={updateStatus.phase === "checking" || updateStatus.phase === "installing"} onClick={() => void onCheckUpdates()}>Check</Button>
                  )}
                </div>
                <div className="privacy-note">
                  <LockKeyhole size={15} />
                  <p>Captura stores captures and preferences in a local SQLite database, with a second copy in Captura Backups. No account, analytics, server, or sync.</p>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <footer className="page-footer">
          <span>Captura {appVersion}</span>
          <Button variant="ghost" size="sm" onClick={onQuit}>
            <LogOut size={14} />
            Quit Captura
          </Button>
        </footer>
    </section>
  );
}
