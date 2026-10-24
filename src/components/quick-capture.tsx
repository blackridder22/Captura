import { FileText, ImagePlus, Link2, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, type FormEvent, type MouseEvent, type RefObject } from "react";
import { indicatorStyle, useSlidingIndicator } from "../hooks/use-sliding-indicator";
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

/// The composer starts two lines tall and grows one line at a time as the
/// draft gains lines (Shift+Return, Return, or wrapping), up to a cap; past
/// that it scrolls. The queue below gives up the space.
export const COMPOSER_LINE_HEIGHT = 20;
export const COMPOSER_MIN_LINES = 2;
export const COMPOSER_MAX_LINES = 5;

export function composerHeight(scrollHeight: number): number {
  const lines = Math.ceil(scrollHeight / COMPOSER_LINE_HEIGHT);
  return Math.min(COMPOSER_MAX_LINES, Math.max(COMPOSER_MIN_LINES, lines)) * COMPOSER_LINE_HEIGHT;
}

/// Composer card: the kind is a tab row on top (with the image button at its
/// end), the text and Save sit below.
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
  const tabs = useRef<HTMLDivElement>(null);
  const indicator = useSlidingIndicator(tabs, kind);

  useLayoutEffect(() => {
    const field = composerRef.current;
    if (!field) return;
    // Measure with the height transition off: collapse, read the content
    // height, put the old height back, then let the transition carry it to
    // the new one. Measuring mid-transition would report the old height and
    // the field could grow but never shrink.
    const previous = field.style.height || `${COMPOSER_MIN_LINES * COMPOSER_LINE_HEIGHT}px`;
    field.style.transition = "none";
    field.style.height = "0px";
    const next = `${composerHeight(field.scrollHeight)}px`;
    field.style.height = previous;
    void field.offsetHeight;
    field.style.transition = "";
    field.style.height = next;
  }, [content, composerRef]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="quick-capture" onSubmit={submit}>
      <div ref={tabs} className="composer-tabs" role="tablist" aria-label="Capture type">
        {kindOptions.map(({ kind: option, label, icon: Icon }) => (
          <button
            type="button"
            role="tab"
            key={option}
            data-indicator-key={option}
            data-active={kind === option}
            aria-selected={kind === option}
            onClick={() => onKindChange(option)}
          >
            <Icon size={12} strokeWidth={2} />
            {label}
          </button>
        ))}
        <span className="composer-tabs-spacer" />
        <Button type="button" variant="ghost" size="icon" className="add-image-button" aria-label="Add image" title="Add image" aria-haspopup="menu" aria-expanded={imageMenuOpen} aria-busy={importingImages} disabled={importingImages} onClick={onAddImage}><ImagePlus size={15} /></Button>
        <span className="composer-indicator" aria-hidden="true" data-ready={indicator.ready} style={indicatorStyle(indicator)} />
      </div>

      <div className="composer-body">
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
          rows={COMPOSER_MIN_LINES}
        />
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
    </form>
  );
}
