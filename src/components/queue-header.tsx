import { LockKeyhole, Search, Settings2, X } from "lucide-react";
import type { RefObject } from "react";
import { shortcutLabel } from "../lib/shortcuts";
import { Button } from "./ui/button";

type QueueHeaderProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  searchShortcut: string;
  closeShortcut: string;
  openCount: number;
  sectionCount: number;
};

/// Editorial header: the wordmark carries the brand, a status line replaces
/// the icon badge, and search gets the full width underneath.
export function QueueHeader({
  query,
  onQueryChange,
  onOpenSettings,
  onClose,
  searchRef,
  searchShortcut,
  closeShortcut,
  openCount,
  sectionCount,
}: QueueHeaderProps) {
  return (
    <header className="queue-header">
      <div className="queue-header-row">
        <div className="brand-lockup">
          <strong>Captura</strong>
          <span className="local-status">
            <span>{openCount} open</span>
            <i />
            <span>{sectionCount} section{sectionCount === 1 ? "" : "s"}</span>
            <i />
            <span className="local-status-badge"><LockKeyhole size={10} strokeWidth={2} />Local only</span>
          </span>
        </div>

        <div className="header-actions">
          <Button
            variant="surface"
            size="icon"
            aria-label="Open settings"
            onClick={onOpenSettings}
          >
            <Settings2 size={16} strokeWidth={1.8} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="panel-close-button"
            aria-label="Close Captura"
            title={`Close Captura (${shortcutLabel(closeShortcut)})`}
            onClick={onClose}
          >
            <X size={15} strokeWidth={2} />
          </Button>
        </div>
      </div>

      <label className="search-control">
        <Search size={14} strokeWidth={2} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search captures, links and prompts"
          aria-label="Search captures"
        />
        <kbd>{shortcutLabel(searchShortcut)}</kbd>
      </label>
    </header>
  );
}
