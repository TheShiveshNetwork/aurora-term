import { cn } from "@/lib/utils"
import { marked } from "marked"
import { memo, useId, useMemo } from "react"
import ReactMarkdown, { Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { CodeBlock, CodeBlockCode } from "./code-block"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => token.raw)
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/language-(\\w+)/)
  return match ? match[1] : "plaintext"
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, ...props }) {
    const isInline =
      !props.node?.position?.start.line ||
      props.node?.position?.start.line === props.node?.position?.end.line

    if (isInline) {
      return (
        <code
          className={cn(
            "bg-[#1A2230] text-[#E8EAF0] rounded-sm px-1.5 py-0.5 font-mono text-[12px] border border-white/[0.06]",
            className
          )}
          {...props}
        >
          {children}
        </code>
      )
    }

    const language = extractLanguage(className)

    return (
      <CodeBlock className={className}>
        <CodeBlockCode code={children as string} language={language} />
      </CodeBlock>
    )
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>
  },
  // Tables: fixed layout at 100% width so columns always fit the available
  // space and cells wrap — no horizontal scroll for wide tables.
  table: function TableComponent({ children, ...props }) {
    return (
      <table
        className="w-full table-fixed border-collapse my-2 text-[13px]"
        {...props}
      >
        {children}
      </table>
    )
  },
  th: function ThComponent({ children, ...props }) {
    return (
      <th
        className="border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-left font-semibold text-on-surface/90 break-words align-top"
        {...props}
      >
        {children}
      </th>
    )
  },
  td: function TdComponent({ children, ...props }) {
    return (
      <td
        className="border border-white/[0.06] px-2.5 py-1.5 text-on-surface/75 align-top break-words"
        {...props}
      >
        {children}
      </td>
    )
  },
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = INITIAL_COMPONENTS,
  }: {
    content: string
    components?: Partial<Components>
  }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    )
  }
)

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock"

function MarkdownComponent({
  children,
  id,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children])

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
