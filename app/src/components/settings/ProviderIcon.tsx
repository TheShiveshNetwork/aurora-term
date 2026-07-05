import React from "react";
import { ProviderName } from "@aurora/types";
import { ProviderRegistry } from "../../lib/providers";

export const DISPLAY_NAMES: Record<ProviderName, string> = {} as Record<ProviderName, string>;
for (const p of ProviderRegistry.getAll()) {
  DISPLAY_NAMES[p.id] = p.displayName;
}

interface ProviderIconProps {
  name: ProviderName;
  size?: number;
  className?: string;
}

export function ProviderIcon({ name, size = 20, className = "" }: ProviderIconProps) {
  const info = ProviderRegistry.get(name);
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      fill={info.brandColor}
    >
      <path d={info.iconPath} />
    </svg>
  );
}
