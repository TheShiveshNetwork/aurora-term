import * as React from "react"
import { cn } from "../../lib/utils"

export const Avatar = ({ children, className, ...props }: any) => (
  <div className={cn("relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full", className)} {...props}>
    {children}
  </div>
)

export const AvatarImage = ({ src, alt, className, ...props }: any) => (
  <img src={src} alt={alt} className={cn("aspect-square h-full w-full", className)} {...props} />
)

export const AvatarFallback = ({ children, className, ...props }: any) => (
  <div className={cn("flex h-full w-full items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)] text-[11px] font-semibold text-on-surface-variant", className)} {...props}>
    {children}
  </div>
)
