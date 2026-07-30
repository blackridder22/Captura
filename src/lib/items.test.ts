import { describe, expect, it } from "vitest";
import type { CaptureItem } from "../types";
import { filterItems, inferKind } from "./items";

const items: CaptureItem[] = [
  {
    id: "prompt",
    kind: "prompt",
    content: "Ask for three sharper hooks",
    status: "open",
  sourceApp: "ChatGPT",
  sourceBundleId: "com.openai.chat",
  sectionId: null,
    createdAt: "2026-07-29T12:00:00Z",
    updatedAt: "2026-07-29T12:00:00Z",
  },
  {
    id: "note",
    kind: "note",
    content: "Keep the queue quiet",
    status: "done",
  sourceApp: null,
  sourceBundleId: null,
  sectionId: null,
    createdAt: "2026-07-29T12:00:00Z",
    updatedAt: "2026-07-29T12:00:00Z",
  },
];

describe("inferKind", () => {
  it("recognizes links and prompt-shaped text", () => {
    expect(inferKind("https://shadcn.com/copper")).toBe("link");
    expect(inferKind("Turn this into a checklist")).toBe("prompt");
    expect(inferKind("A thought worth keeping")).toBe("note");
  });
});

describe("filterItems", () => {
  it("applies status, kind, and search filters", () => {
    expect(filterItems(items, "inbox", "")).toHaveLength(1);
    expect(filterItems(items, "done", "")[0]?.id).toBe("note");
    expect(filterItems(items, "prompts", "chatgpt")[0]?.id).toBe(
      "prompt",
    );
  });
});
