import { describe, expect, it } from "vitest";
import type { CaptureItem } from "../types";
import { buildDemoCopyPayload } from "./api";

function item(
  id: string,
  content: string,
  kind: CaptureItem["kind"] = "note",
): CaptureItem {
  return {
    id,
    kind,
    content,
    status: "open",
    sourceApp: null,
    sourceBundleId: null,
    sectionId: null,
    attachmentPath: kind === "image" ? "/tmp/capture.png" : null,
    createdAt: "2026-08-04T00:00:00Z",
    updatedAt: "2026-08-04T00:00:00Z",
  };
}

describe("copy payloads", () => {
  it("preserves exact Markdown source and visible order", () => {
    const first = item(
      "first",
      "# Heading\n\n- parent\n  - child\n\n[Link](https://example.com)",
    );
    const second = item(
      "second",
      "```ts\nconst answer = 42;\n```\n\nLast paragraph.",
      "prompt",
    );

    expect(buildDemoCopyPayload([first], "native")).toMatchObject({
      kind: "text",
      text: first.content,
      result: { format: "markdown", count: 1 },
    });
    expect(buildDemoCopyPayload([first, second], "sourceMarkdown")).toMatchObject(
      {
        kind: "text",
        text: `${first.content}\n\n${second.content}`,
        result: { format: "markdown", count: 2 },
      },
    );
  });

  it("keeps list transformation separate and rejects mixed selections", () => {
    const text = item("text", "First\n\n  continuation");
    const image = item("image", "Image capture", "image");

    expect(buildDemoCopyPayload([text], "markdownList")).toMatchObject({
      kind: "text",
      text: "- First   continuation",
      result: { format: "markdownList", count: 1 },
    });
    expect(() =>
      buildDemoCopyPayload([text, image], "sourceMarkdown"),
    ).toThrow("Select only text captures to copy Markdown.");
    expect(() => buildDemoCopyPayload([text, image], "markdownList")).toThrow(
      "Select only text captures to copy Markdown.",
    );
  });

  it("resolves a native image instead of copying its label", () => {
    expect(buildDemoCopyPayload([item("image", "Image capture", "image")], "native"))
      .toMatchObject({
        kind: "image",
        path: "/tmp/capture.png",
        result: { format: "image", count: 1 },
      });
  });
});
