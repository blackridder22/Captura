import { ClipboardPaste, ImagePlus } from "lucide-react";
import { useMenuFocus, useMenuPosition } from "../hooks/use-menu-position";

export function ImageImportMenu({ x, y, onChoose, onPaste, onClose }: { x: number; y: number; onChoose: () => void; onPaste: () => void; onClose: () => void }) {
  const { ref, position } = useMenuPosition(x, y);
  useMenuFocus(ref);
  return <div ref={ref} className="image-import-menu" role="menu" aria-label="Add image" style={position} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (["ArrowDown", "ArrowUp", "Tab"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === "ArrowUp" || event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }}><button role="menuitem" onClick={onChoose}><ImagePlus size={14} />Choose images…</button><button role="menuitem" onClick={onPaste}><ClipboardPaste size={14} />Paste image</button></div>;
}
