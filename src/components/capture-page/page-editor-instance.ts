import { createDocument, Editor, type JSONContent } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { pageExtensions } from "./markdown-adapter";
import { SlashCommand } from "./slash-command";

export const PAGE_PLACEHOLDER = "Write anything. Type / for a block.";

// One editor for the app's lifetime. Building the schema and plugins is the
// most expensive part of opening a capture; EditorContent moves the live view
// into whichever page is open and back out when it closes.
let shared: Editor | null = null;
const slashContainer: { current: HTMLElement | null } = { current: null };

export function getSharedPageEditor(): Editor {
  if (!shared || shared.isDestroyed) {
    shared = new Editor({
      extensions: [...pageExtensions(PAGE_PLACEHOLDER), SlashCommand.configure({ container: () => slashContainer.current })],
      content: "",
      editable: false,
      editorProps: {
        attributes: { class: "page-editor markdown-content", "aria-label": "Capture page", spellcheck: "true" },
      },
    });
  }
  return shared;
}

export function setSlashContainer(element: HTMLElement | null) {
  slashContainer.current = element;
}

/// Idle warm-up after the queue paints, so the first open pays only for the
/// capture itself.
export function warmPageEditor() {
  getSharedPageEditor();
}

/// Replaces the document and clears history and selection without emitting
/// an update, so loading a capture never counts as an edit.
export function resetDocument(editor: Editor, content: JSONContent) {
  const doc = createDocument(content, editor.schema, editor.options.parseOptions);
  editor.view.updateState(EditorState.create({ doc, schema: editor.schema, plugins: editor.state.plugins }));
}
