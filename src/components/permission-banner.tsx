import { Keyboard, ShieldAlert } from "lucide-react";
import type { PermissionExperience } from "../lib/permission-state";
import { Button } from "./ui/button";

type PermissionBannerProps = {
  experience: Extract<
    PermissionExperience,
    "limited" | "repair" | "shortcutConflict"
  >;
  onOpenAccessibility: () => Promise<void>;
  onCheckAgain: () => Promise<unknown>;
  onOpenShortcutSettings: () => void;
};

export function PermissionBanner({
  experience,
  onOpenAccessibility,
  onCheckAgain,
  onOpenShortcutSettings,
}: PermissionBannerProps) {
  const shortcutConflict = experience === "shortcutConflict";

  return (
    <div className="permission-banner" role="alert">
      <span className="permission-banner-icon">
        {shortcutConflict ? <Keyboard size={15} /> : <ShieldAlert size={15} />}
      </span>
      <p>
        {shortcutConflict
          ? "Global capture shortcut is unavailable. Choose another shortcut in Settings."
          : "Accessibility is off. Selection capture and paste back are paused."}
      </p>
      {shortcutConflict ? (
        <Button variant="surface" size="sm" onClick={onOpenShortcutSettings}>
          Open Settings
        </Button>
      ) : (
        <>
          <Button
            variant="surface"
            size="sm"
            onClick={() => void onOpenAccessibility()}
          >
            Open Settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onCheckAgain()}
          >
            Check again
          </Button>
        </>
      )}
    </div>
  );
}
