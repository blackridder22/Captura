import { Code2, Eye, FileText, Link2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CaptureItem, ItemKind } from "../types";
import { MarkdownText } from "./markdown-text";
import { Button } from "./ui/button";

type EditSheetProps = {
  item: CaptureItem;
  onClose: () => void;
  onSave: (content: string, kind: ItemKind) => Promise<void>;
};

const kinds = [
  { value: "prompt" as const, label: "Prompt", icon: Sparkles },
  { value: "note" as const, label: "Note", icon: FileText },
  { value: "link" as const, label: "Link", icon: Link2 },
];

export function EditSheet({ item, onClose, onSave }: EditSheetProps) {
  const [content, setContent] = useState(item.content);
  const [kind, setKind] = useState<ItemKind>(item.kind);
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setContent(item.content);
    setKind(item.kind);
    setMode("preview");
  }, [item]);

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <form
        className="edit-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!content.trim()) return;
          setSaving(true);
          try {
            await onSave(content, kind);
          } finally {
            setSaving(false);
          }
        }}
      >
        <header>
          <div>
            <span>Edit capture</span>
            <strong>Keep the useful part.</strong>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close editor"
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </header>

        {item.kind === "image" ? (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            aria-label="Image caption"
            autoFocus
            rows={7}
          />
        ) : (
          <>
            <div
              className="edit-mode-switcher"
              role="tablist"
              aria-label="Edit mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "preview"}
                data-active={mode === "preview"}
                onClick={() => setMode("preview")}
              >
                <Eye size={12} />
                Preview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "source"}
                data-active={mode === "source"}
                onClick={() => setMode("source")}
              >
                <Code2 size={12} />
                Source
              </button>
            </div>
            {mode === "preview" ? (
              <div
                className="edit-rendered-surface"
                role="tabpanel"
                aria-label="Rendered Markdown preview"
                tabIndex={0}
              >
                <MarkdownText content={content} />
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                aria-label="Markdown source"
                autoFocus
                rows={7}
              />
            )}
          </>
        )}

        <footer>
          {item.kind === "image" ? (
            // Images stay images; the text field edits the caption.
            <div className="sheet-kind-switcher" data-static="true">
              <span>Image caption</span>
            </div>
          ) : (
            <div className="sheet-kind-switcher">
              {kinds.map(({ value, label, icon: Icon }) => (
                <button
                  type="button"
                  key={value}
                  data-active={kind === value}
                  onClick={() => setKind(value)}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          )}
          <Button
            type="submit"
            variant="accent"
            disabled={!content.trim() || saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
