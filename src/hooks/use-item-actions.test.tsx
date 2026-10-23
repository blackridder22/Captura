import { act, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickCapture } from "../components/quick-capture";
import * as api from "../lib/api";
import type { CaptureItem, SectionFilter } from "../types";
import { useItemActions } from "./use-item-actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/api", () => ({
  createItem: vi.fn(),
  createSection: vi.fn(),
  deleteSection: vi.fn(),
  deleteItems: vi.fn(),
  restoreItems: vi.fn(),
  purgeItems: vi.fn(),
  moveItemsToSection: vi.fn(),
  pasteItem: vi.fn(),
  toggleItem: vi.fn(),
}));

const saved: CaptureItem = {
  id: "capture",
  content: "Draft",
  kind: "note",
  status: "open",
  sourceApp: null,
  sourceBundleId: null,
  sectionId: null,
  attachmentPath: null,
  thumbnailPath: null,
  imageWidth: null,
  imageHeight: null, deletedAt: null,
  createdAt: "2026-09-05T10:00:00Z",
  updatedAt: "2026-09-05T10:00:00Z",
};
const callbacks = {
  prependItem: vi.fn(),
  prependDeduped: vi.fn(),
  replaceItem: vi.fn(),
  removeItems: vi.fn(),
  addSection: vi.fn(),
  removeSection: vi.fn(),
  applyUpdatedItems: vi.fn(),
  setFilter: vi.fn(),
  setContextMenu: vi.fn(),
  setSingle: vi.fn(),
  announce: vi.fn(),
  notify: vi.fn(),
};
let actions: ReturnType<typeof useItemActions>;

function Harness({
  content = "Draft",
  kind = "note",
  section = "all",
}: {
  content?: string;
  kind?: CaptureItem["kind"];
  section?: SectionFilter;
}) {
  const [composer, setComposer] = useState(content);
  const [composerKind, setComposerKind] = useState(kind);
  const [saving, setSaving] = useState(false);
  const [sectionFilter, setSectionFilter] = useState(section);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);
  actions = useItemActions({
    ...callbacks,
    composer,
    composerKind,
    saving,
    sectionFilter,
    setComposer,
    setSaving,
    setSectionFilter,
    focusComposer,
  });

  return (
    <>
      <QuickCapture
        content={composer}
        kind={composerKind}
        onContentChange={setComposer}
        onKindChange={setComposerKind}
        onSubmit={actions.handleCreate}
        composerRef={composerRef}
        saving={saving}
        saveShortcut="CommandOrControl+Enter"
        importingImages={false}
        imageMenuOpen={false}
        onAddImage={() => {}}
      />
      <output data-section>{sectionFilter}</output>
    </>
  );
}

describe("Quick Capture saving", () => {
  let container: HTMLDivElement;
  let root: Root;
  const composer = () => container.querySelector("textarea")!;
  const saveButton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const mount = async (props: Parameters<typeof Harness>[0] = {}) => {
    await act(async () => root.render(<Harness {...props} />));
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.createItem).mockImplementation(async (input) => ({
      ...saved,
      content: input.content,
      kind: input.kind,
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(["note", "prompt"] as const)("preserves the exact Markdown source when saving a %s", async (kind) => {
    const content = '    const greeting = "café / 日本語";\n\nA hard break  \nNext line\n\n';
    await mount({ content, kind });
    await act(async () => saveButton().click());

    expect(api.createItem).toHaveBeenCalledExactlyOnceWith({ content, kind });
    expect(callbacks.prependItem).toHaveBeenCalledWith(expect.objectContaining({ content, kind }));
    expect(composer().value).toBe("");
    expect(callbacks.announce).toHaveBeenCalledWith("Capture saved");
    expect(document.activeElement).toBe(composer());
  });

  it("keeps a failed draft and enables Save again so a retry can succeed", async () => {
    const content = "    Keep this draft\n\n";
    vi.mocked(api.createItem).mockRejectedValueOnce(new Error("Database is locked"));
    await mount({ content });
    saveButton().focus();
    await act(async () => actions.handleCreate());

    expect(composer().value).toBe(content);
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().textContent).toContain("Save");
    expect(saveButton().textContent).not.toContain("Saving");
    expect(callbacks.notify).toHaveBeenCalledWith(expect.stringContaining("Try again"), "error");
    expect(callbacks.prependItem).not.toHaveBeenCalled();
    expect(callbacks.announce).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(composer());

    await act(async () => saveButton().click());
    expect(api.createItem).toHaveBeenCalledTimes(2);
    expect(api.createItem).toHaveBeenLastCalledWith({ content, kind: "note" });
    expect(callbacks.prependItem).toHaveBeenCalledOnce();
    expect(composer().value).toBe("");
  });

  it("ignores whitespace-only drafts even when invoked through a shortcut", async () => {
    await mount({ content: " \t\n " });
    expect(saveButton().disabled).toBe(true);
    await act(async () => actions.handleCreate());
    expect(api.createItem).not.toHaveBeenCalled();
    expect(callbacks.notify).not.toHaveBeenCalled();
  });

  it("prevents two submits before the first render or IPC completes", async () => {
    let resolveSave!: (item: CaptureItem) => void;
    vi.mocked(api.createItem).mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    await mount();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = actions.handleCreate();
      second = actions.handleCreate();
    });
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().textContent).toContain("Saving");
    await act(async () => {
      resolveSave(saved);
      await Promise.all([first, second]);
    });
    expect(api.createItem).toHaveBeenCalledOnce();
    expect(callbacks.prependItem).toHaveBeenCalledOnce();
  });

  it("files a successful save in the selected section", async () => {
    const filed = { ...saved, sectionId: "research" };
    vi.mocked(api.moveItemsToSection).mockResolvedValueOnce([filed]);
    await mount({ section: "research" });
    await act(async () => saveButton().click());

    expect(api.moveItemsToSection).toHaveBeenCalledExactlyOnceWith([saved.id], "research");
    expect(callbacks.prependItem).toHaveBeenCalledWith(filed);
    expect(container.querySelector("[data-section]")?.textContent).toBe("research");
    expect(callbacks.notify).not.toHaveBeenCalled();
    expect(composer().value).toBe("");
  });

  it("shows an already-saved capture in Unfiled when section assignment fails", async () => {
    vi.mocked(api.moveItemsToSection).mockRejectedValueOnce("Section no longer exists");
    await mount({ section: "research" });
    await act(async () => actions.handleCreate());

    expect(callbacks.prependItem).toHaveBeenCalledExactlyOnceWith(saved);
    expect(callbacks.setSingle).toHaveBeenCalledWith(saved.id);
    expect(callbacks.setFilter).toHaveBeenCalledWith("inbox");
    expect(container.querySelector("[data-section]")?.textContent).toBe("unfiled");
    expect(callbacks.notify).toHaveBeenCalledWith(expect.stringContaining("saved to Unfiled"), "error");
    expect(callbacks.announce).not.toHaveBeenCalled();
    expect(composer().value).toBe("");
    expect(saveButton().textContent).not.toContain("Saving");

    await act(async () => actions.handleCreate());
    expect(api.createItem).toHaveBeenCalledOnce();
  });
});
