import { describe, expect, it } from "vitest";
import type { CaptureItem } from "../types";
import {
  applySectionFilter,
  captureTitle,
  countItems,
  filterItems,
  inferKind,
  matchesQueueFilter,
} from "./items";

const items: CaptureItem[] = [
  {
    id: "prompt",
    kind: "prompt",
    content: "Ask for three sharper hooks",
    status: "open",
  sourceApp: "ChatGPT",
  sourceBundleId: "com.openai.chat",
  sectionId: null,
  attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null, deletedAt: null,
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
  attachmentPath: null, thumbnailPath: null, imageWidth: null, imageHeight: null, deletedAt: null,
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

describe("trash filtering", () => {
  const trashed: CaptureItem = { ...items[0]!, id: "trashed", deletedAt: "2026-07-30T12:00:00Z" };
  const all = [...items, trashed];

  it("keeps trashed captures out of every live filter and shows only them in Trash", () => {
    expect(filterItems(all, "inbox", "").map((item) => item.id)).toEqual(["prompt"]);
    expect(filterItems(all, "prompts", "").map((item) => item.id)).toEqual(["prompt"]);
    expect(filterItems(all, "trash", "").map((item) => item.id)).toEqual(["trashed"]);
    expect(filterItems(all, "trash", "sharper").map((item) => item.id)).toEqual(["trashed"]);
    expect(matchesQueueFilter(trashed, "done")).toBe(false);
    expect(matchesQueueFilter(items[1]!, "trash")).toBe(false);
  });

  it("counts trash separately from live captures", () => {
    expect(countItems(all)).toEqual({ inbox: 1, prompts: 1, notes: 0, done: 1, trash: 1 });
  });
});

describe("captureTitle", () => {
  it("uses the first non-empty line without Markdown markers", () => {
    expect(captureTitle("\n\n## Release **plan**\n\nbody")).toBe("Release plan");
    expect(captureTitle("- [ ] buy milk")).toBe("buy milk");
    expect(captureTitle("   ")).toBe("Untitled capture");
  });
});

describe("applySectionFilter", () => {
  const sectioned = [
    { ...items[0]!, id: "filed", sectionId: "section-1" },
    { ...items[1]!, id: "loose", sectionId: null },
  ];

  it("passes everything through for all", () => {
    expect(applySectionFilter(sectioned, "all")).toHaveLength(2);
  });

  it("narrows to unfiled items", () => {
    expect(applySectionFilter(sectioned, "unfiled")[0]?.id).toBe("loose");
  });

  it("narrows to a specific section", () => {
    expect(applySectionFilter(sectioned, "section-1")[0]?.id).toBe("filed");
  });
});

describe("countItems", () => {
  it("tallies open, kind-specific, and done items", () => {
    expect(countItems(items)).toEqual({
      inbox: 1,
      prompts: 1,
      notes: 0,
      done: 1,
      trash: 0,
    });
  });
});
