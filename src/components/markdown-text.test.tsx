import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText, safeMarkdownUrl } from "./markdown-text";

describe("safe Markdown rendering", () => {
  it("drops raw HTML and scriptable links", () => {
    const rendered = renderToStaticMarkup(
      <MarkdownText content={'<script>alert("x")</script> [bad](javascript:alert(1))'} />,
    );
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("javascript:");
  });

  it("allows ordinary Markdown and safe external links", () => {
    const rendered = renderToStaticMarkup(
      <MarkdownText content={"**Keep this** [source](https://example.com)"} />,
    );
    expect(rendered).toContain("<strong>Keep this</strong>");
    expect(rendered).toContain('href="https://example.com"');
    expect(rendered).toContain('rel="noopener noreferrer"');
  });

  it("allowlists only web and email protocols", () => {
    expect(safeMarkdownUrl("https://example.com")).toBe(
      "https://example.com",
    );
    expect(safeMarkdownUrl("mailto:hello@example.com")).toBe(
      "mailto:hello@example.com",
    );
    expect(safeMarkdownUrl("file:///etc/passwd")).toBe("");
    expect(safeMarkdownUrl("javascript:alert(1)")).toBe("");
  });
});
