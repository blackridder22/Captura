import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SlashItem } from "./slash-items";

export type SlashMenuHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };
export type SlashMenuProps = SuggestionProps<SlashItem, SlashItem>;

/// Keyboard-first block palette: ↑↓ move, ↩ or ⇥ insert, Esc is left to the
/// suggestion plugin so it can close the palette without closing the page.
export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu({ items, command, query }, ref) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);

  const choose = (position: number) => {
    const item = items[position];
    if (item) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setIndex((current) => (current + items.length - 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((current) => (current + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (!items.length) return false;
        choose(index);
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="slash-menu" role="listbox" aria-label="Insert block" data-empty={items.length === 0}>
      {items.length ? (
        items.map((item, position) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={position === index}
              data-active={position === index}
              onMouseEnter={() => setIndex(position)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(position)}
            >
              <span className="slash-menu-icon"><Icon size={14} strokeWidth={1.9} /></span>
              <span className="slash-menu-copy">
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          );
        })
      ) : (
        <p className="slash-menu-empty">No block matches “{query}”</p>
      )}
    </div>
  );
});
