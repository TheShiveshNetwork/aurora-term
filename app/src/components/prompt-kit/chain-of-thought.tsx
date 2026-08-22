"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { ChevronDown, Circle } from "lucide-react"
import React from "react"

export type ChainOfThoughtItemProps = React.ComponentProps<"div">

export const ChainOfThoughtItem = ({
  children,
  className,
  ...props
}: ChainOfThoughtItemProps) => (
  <div className={cn("text-on-surface-variant/60 text-xs", className)} {...props}>
    {children}
  </div>
)

export type ChainOfThoughtTriggerProps = React.ComponentProps<
  typeof CollapsibleTrigger
> & {
  leftIcon?: React.ReactNode
  swapIconOnHover?: boolean
}

export const ChainOfThoughtTrigger = ({
  children,
  className,
  leftIcon,
  swapIconOnHover = true,
  ...props
}: ChainOfThoughtTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "group text-on-surface-variant/50 hover:text-on-surface-variant/70 flex cursor-pointer items-center justify-start gap-1 text-left text-[11px] font-medium transition-colors min-w-0",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2 min-w-0">
      {leftIcon ? (
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
          <span
            className={cn(
              "transition-opacity",
              swapIconOnHover && "group-hover:opacity-0"
            )}
          >
            {leftIcon}
          </span>
          {swapIconOnHover && (
            <ChevronDown className="absolute size-4 opacity-0 transition-opacity group-hover:opacity-100 group-data-[state=open]:rotate-180" />
          )}
        </span>
      ) : (
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
          <Circle className="size-2.5 fill-current" />
        </span>
      )}
      <span className="min-w-0 whitespace-normal break-words">{children}</span>
    </div>
    {!leftIcon && (
      <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
    )}
  </CollapsibleTrigger>
)

export type ChainOfThoughtContentProps = React.ComponentProps<
  typeof CollapsibleContent
>

export const ChainOfThoughtContent = ({
  children,
  className,
  ...props
}: ChainOfThoughtContentProps) => {
  return (
    <CollapsibleContent
      className={cn(
        "text-popover-foreground data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden",
        className
      )}
      {...props}
    >
      <div className="grid grid-cols-[min-content_minmax(0,1fr)] gap-x-4">
        <div className="bg-primary/20 ml-1.75 h-full w-px group-data-[last=true]:hidden" />
        <div className="ml-1.75 h-full w-px bg-transparent group-data-[last=false]:hidden" />
        <div className="space-y-2">{children}</div>
      </div>
    </CollapsibleContent>
  )
}

export type ChainOfThoughtCommandProps = React.ComponentProps<"pre">

export const ChainOfThoughtCommand = ({
  children,
  className,
  ...props
}: ChainOfThoughtCommandProps) => (
  <pre
    className={cn(
      "mt-2 p-2 rounded-sm border border-white/[0.06] bg-[#0D1117] text-[11px] font-mono overflow-x-auto text-on-surface/80 leading-normal select-text",
      className
    )}
    {...props}
  >
    {children}
  </pre>
)

export type ChainOfThoughtProps = {
  children: React.ReactNode
  className?: string
}

export function ChainOfThought({ children, className }: ChainOfThoughtProps) {
  const childrenArray = React.Children.toArray(children)

  return (
    <div
      className={cn(
        "space-y-0",
        className
      )}
    >
      {childrenArray.map((child, index) => (
        <React.Fragment key={index}>
          {React.isValidElement(child) &&
            React.cloneElement(
              child as React.ReactElement<ChainOfThoughtStepProps>,
              {
                isLast: index === childrenArray.length - 1,
              }
            )}
        </React.Fragment>
      ))}
    </div>
  )
}

export type ChainOfThoughtStepProps = {
  children: React.ReactNode
  className?: string
  isLast?: boolean
}

export const ChainOfThoughtStep = ({
  children,
  className,
  isLast = false,
  ...props
}: ChainOfThoughtStepProps & React.ComponentProps<typeof Collapsible>) => {
  return (
    <Collapsible
      className={cn("group", className)}
      data-last={isLast}
      {...props}
    >
      {children}
      <div className="flex justify-start group-data-[last=true]:hidden">
        <div className="ml-1.75 h-4 w-px" />
      </div>
    </Collapsible>
  )
}
