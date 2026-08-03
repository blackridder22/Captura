import { ShieldAlert, X } from "lucide-react";
import { Button } from "./ui/button";

type PermissionBannerProps = {
  onAllow: () => void;
  onDismiss: () => void;
};

export function PermissionBanner({ onAllow, onDismiss }: PermissionBannerProps) {
  return (
    <div className="permission-banner" role="note">
      <span className="permission-banner-icon">
        <ShieldAlert size={15} />
      </span>
      <p>
        <strong>Finish setup.</strong> Captura needs Accessibility access to
        capture selections and paste back.
      </p>
      <Button variant="accent" size="sm" onClick={onAllow}>
        Allow
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss permission reminder"
        onClick={onDismiss}
      >
        <X size={13} />
      </Button>
    </div>
  );
}
