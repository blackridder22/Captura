import { FileText, ImagePlus, Link2, Sparkles } from "lucide-react";
import type { FormEvent, MouseEvent, RefObject } from "react";
import type { ItemKind } from "../types";
import { matchesShortcut, shortcutLabel } from "../lib/shortcuts";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";

type QuickCaptureProps = {
  content: string;
  kind: ItemKind;
  onContentChange: (value: string) => void;
  onKindChange: (kind: ItemKind) => void;
  onSubmit: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  saving: boolean;
  saveShortcut: string;
  importingImages: boolean;
  imageMenuOpen: boolean;
  onAddImage: (event: MouseEvent<HTMLButtonElement>) => void;
};

const kindOptions = [
  { kind: "prompt" as const, label: "Prompt", icon: Sparkles },
  { kind: "note" as const, label: "Note", icon: FileText },
  { kind: "link" as const, label: "Link", icon: Link2 },
];

export function QuickCapture({
  content,
  kind,
  onContentChange,
  onKindChange,
  onSubmit,
  composerRef,
  saving,
  saveShortcut,
  importingImages,
  imageMenuOpen,
  onAddImage,
}: QuickCaptureProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="quick-capture" onSubmit={submit}>
      <textarea
        ref={composerRef}
        value={content}
        onChange={(event) => onContentChange(event.target.value)}
        onKeyDown={(event) => {
          if (matchesShortcut(event.nativeEvent, saveShortcut)) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Save a thought, prompt, link…"
        aria-label="Capture a thought, prompt, or link"
        rows={2}
      />

      <div className="composer-footer">
        <div className="kind-switcher" aria-label="Capture type">
          {kindOptions.map(({ kind: option, label, icon: Icon }) => (
            <button
              type="button"
              key={option}
              data-active={kind === option}
              onClick={() => onKindChange(option)}
              aria-pressed={kind === option}
            >
              <Icon size={12} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>

        <div className="composer-actions">
          <Button type="button" variant="ghost" size="icon" className="add-image-button" aria-label="Add image" title="Add image" aria-haspopup="menu" aria-expanded={imageMenuOpen} aria-busy={importingImages} disabled={importingImages} onClick={onAddImage}><ImagePlus size={15} /></Button>
          <Button
          type="submit"
          variant="accent"
          size="sm"
          disabled={!content.trim() || saving}
        >
          {saving ? "Saving" : "Save"}
          <Kbd>{shortcutLabel(saveShortcut)}</Kbd>
          </Button>
        </div>
      </div>
    </form>
  );
}
