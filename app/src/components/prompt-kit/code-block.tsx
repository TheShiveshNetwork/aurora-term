"use client"

import { cn } from "@/lib/utils"
import React, { useEffect, useState } from "react"
import { codeToHtml } from "shiki"

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        // Removed overflow-x-auto from here so the background container can handle it
        "not-prose w-full border border-white/[0.06] rounded-sm overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlockCode({
  code,
  language = "tsx",
  theme = "github-dark",
  className,
  ...props
}: CodeBlockCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  useEffect(() => {
    async function highlight() {
      if (!code) {
        setHighlightedHtml("<pre><code></code></pre>")
        return
      }

      const html = await codeToHtml(code, { lang: language, theme })
      setHighlightedHtml(html)
    }
    highlight()
  }, [code, language, theme])

  // Added `overflow-x-auto` to the outer wrappers below, and ensured 
  // the pre tag inside uses `w-max min-w-full` so it stretches the background.
  return highlightedHtml ? (
    <div
      className={cn(
        "w-full min-w-full bg-[#0D1117] text-on-surface text-[13px] overflow-x-auto",
        "[&>pre]:m-0 [&>pre]:w-max [&>pre]:min-w-full [&>pre]:px-4 [&>pre]:py-3 [&>pre]:text-[13px] [&>pre]:leading-relaxed",
        className
      )}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      {...props}
    />
  ) : (
    <div
      className={cn(
        "w-full min-w-full bg-[#0D1117] text-on-surface text-[13px] overflow-x-auto",
        className
      )}
      {...props}
    >
      <pre className="m-0 w-max min-w-full px-4 py-3 text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }