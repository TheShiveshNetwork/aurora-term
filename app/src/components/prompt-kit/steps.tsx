"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"

export type StepsItemProps = React.ComponentProps<"div">

export const StepsItem = ({
  children,
  className,
  ...props
}: StepsItemProps) => (
  <div className={cn("font-mono text-[10.5px] leading-relaxed text-on-surface-variant/50 break-all whitespace-normal", className)} {...props}>
    {children}
  </div>
)

export type StepsTriggerProps = React.ComponentProps<
  typeof CollapsibleTrigger
> & {
  leftIcon?: React.ReactNode
  swapIconOnHover?: boolean
}

export const StepsTrigger = ({
  children,
  className,
  leftIcon,
  swapIconOnHover = true,
  ...props
}: StepsTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "group flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.02] text-on-surface-variant/70 transition-colors min-w-0",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2.5 min-w-0">
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
      ) : null}
      <span className="text-[12.5px] font-medium min-w-0 whitespace-normal break-words">{children}</span>
    </div>
    <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
)

export type StepsContentProps = React.ComponentProps<
  typeof CollapsibleContent
> & {
  bar?: React.ReactNode
}

export const StepsContent = ({
  children,
  className,
  bar,
  ...props
}: StepsContentProps) => {
  return (
    <CollapsibleContent
      className={cn(
        "text-popover-foreground data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden",
        className
      )}
      {...props}
    >
      <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin pr-1">
        {children}
      </div>
    </CollapsibleContent>
  )
}

export type StepsBarProps = React.HTMLAttributes<HTMLDivElement>

export const StepsBar = ({ className, ...props }: StepsBarProps) => (
  <div
    className={cn("bg-muted h-full w-[2px]", className)}
    aria-hidden
    {...props}
  />
)

export type StepsCountBadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  count: number
}

export const StepsCountBadge = ({ count, className, ...props }: StepsCountBadgeProps) => (
  <span
    className={cn(
      "flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10.5px] font-medium text-primary",
      className
    )}
    {...props}
  >
    {count}
  </span>
)

export type StepsProps = React.ComponentProps<typeof Collapsible>

export function Steps({ defaultOpen = false, className, ...props }: StepsProps) {
  return (
    <Collapsible
      className={cn(
        "overflow-hidden",
        className
      )}
      defaultOpen={defaultOpen}
      {...props}
    />
  )
}
