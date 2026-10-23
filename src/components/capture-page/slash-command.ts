import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { filterSlashItems, slashItems, type SlashItem } from "./slash-items";
import { SlashMenu, type SlashMenuHandle, type SlashMenuProps } from "./slash-menu";

export type SlashCommandOptions = {
  /// Element the palette is positioned within (the capture sheet). Falls back
  /// to the document body.
  container: () => HTMLElement | null;
};

const slashPluginKey = new PluginKey("captura-slash-command");

/// `/` opens the block palette, Notion-style. Positioning stays inside the
/// menubar panel: the palette flips above the caret when there is no room.
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return { container: () => null };
  },

  addProseMirrorPlugins() {
    const container = () => this.options.container() ?? document.body;
    const editor = this.editor;
    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: slashPluginKey,
        editor,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterSlashItems(slashItems, query),
        command: ({ editor: target, range, props }) => props.run(target, range),
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "codeBlock",
        render: () => {
          let renderer: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;
          const place = (props: SuggestionProps<SlashItem, SlashItem>) => {
            const rect = props.clientRect?.();
            if (!renderer || !rect) return;
            const element = renderer.element as HTMLElement;
            const host = container();
            const bounds = host.getBoundingClientRect();
            const width = element.offsetWidth || 224;
            const height = element.offsetHeight || 212;
            let left = rect.left - bounds.left;
            let top = rect.bottom - bounds.top + 6;
            if (left + width > bounds.width - 8) left = Math.max(8, bounds.width - width - 8);
            if (top + height > bounds.height - 8) top = Math.max(8, rect.top - bounds.top - height - 6);
            element.style.left = `${Math.round(left)}px`;
            element.style.top = `${Math.round(top)}px`;
          };
          return {
            onStart: (props) => {
              renderer = new ReactRenderer<SlashMenuHandle, SlashMenuProps>(SlashMenu, {
                props,
                editor: props.editor,
                className: "slash-menu-host",
              });
              container().appendChild(renderer.element);
              place(props);
            },
            onUpdate: (props) => {
              renderer?.updateProps(props);
              place(props);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                // Close the palette only; the page's Escape handler sees
                // defaultPrevented and leaves the sheet open.
                exitSuggestion(props.view, slashPluginKey);
                return true;
              }
              return renderer?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              renderer?.element.remove();
              renderer?.destroy();
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});
