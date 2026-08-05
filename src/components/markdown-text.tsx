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
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
];

export function safeMarkdownUrl(url: string) {
  const normalized = url.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return /^(https?:|mailto:)/i.test(normalized) ? normalized : "";
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
    input: (props: ComponentPropsWithoutRef<"input">) => (
      <input {...props} type="checkbox" disabled />
    ),
  };

  const markdown = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={safeElements}
      unwrapDisallowed
      skipHtml
      urlTransform={safeMarkdownUrl}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );

  return (
    <div className={compact ? "markdown-compact" : "markdown-content"}>
      {markdown}
    </div>
  );
}
