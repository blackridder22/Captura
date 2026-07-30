import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownTextProps = {
  content: string;
  compact?: boolean;
};

const safeElements = [
  "p",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "hr",
  "br",
];

const compactElements = ["p", "strong", "em", "del", "code", "a", "br"];

export function safeMarkdownUrl(url: string) {
  const normalized = url.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return /^(https?:|mailto:)/i.test(normalized) ? normalized : "";
}

function compactMarkdown(content: string) {
  return content
    .trim()
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
}

export function MarkdownText({ content, compact = false }: MarkdownTextProps) {
  const components = {
    a: ({
      children,
      ...props
    }: ComponentPropsWithoutRef<"a">) => (
      <a
        {...props}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </a>
    ),
    ...(compact
      ? {
          p: ({ children }: ComponentPropsWithoutRef<"p">) => (
            <>{children}</>
          ),
        }
      : {}),
  };

  const markdown = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={compact ? compactElements : safeElements}
      unwrapDisallowed
      skipHtml
      urlTransform={safeMarkdownUrl}
      components={components}
    >
      {compact ? compactMarkdown(content) : content}
    </ReactMarkdown>
  );

  return compact ? markdown : <div className="markdown-content">{markdown}</div>;
}
