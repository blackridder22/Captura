import { LockKeyhole, Search, Settings2, X } from "lucide-react";
import type { RefObject } from "react";
import { shortcutLabel } from "../lib/shortcuts";
import { Button } from "./ui/button";
import { BrandMark } from "./brand-mark";

type QueueHeaderProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  searchShortcut: string;
  closeShortcut: string;
};

export function QueueHeader({
  query,
  onQueryChange,
  onOpenSettings,
  onClose,
  searchRef,
  searchShortcut,
  closeShortcut,
}: QueueHeaderProps) {
  return (
    <header className="queue-header">
      <div className="brand-lockup">
        <span className="brand-icon">
          <BrandMark />
        </span>
        <div>
          <strong>Captura</strong>
          <span className="local-status">
            <i />
            Local only
            <LockKeyhole size={11} strokeWidth={2} />
          </span>
        </div>
      </div>

      <label className="search-control">
        <Search size={15} strokeWidth={1.9} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search captures"
          aria-label="Search captures"
        />
        <kbd>{shortcutLabel(searchShortcut)}</kbd>
      </label>

      <div className="header-actions">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open settings"
          onClick={onOpenSettings}
        >
          <Settings2 size={17} strokeWidth={1.8} />
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
    </header>
  );
}
