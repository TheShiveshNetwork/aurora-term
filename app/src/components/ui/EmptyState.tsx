import React from "react";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function EmptyState({ icon, title, description, actions }: EmptyStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center min-h-0">
      <div className="flex flex-col items-center gap-3 text-center px-8">
        <div style={{ color: "rgba(232,234,240,0.15)" }}>{icon}</div>
        <span className="text-sm font-medium" style={{ color: "rgba(232,234,240,0.3)" }}>
          {title}
        </span>
        {description && (
          <span className="text-xs" style={{ color: "rgba(232,234,240,0.2)", maxWidth: 320, lineHeight: 1.5 }}>
            {description}
          </span>
        )}
        {actions && <div className="mt-2">{actions}</div>}
      </div>
    </div>
  );
}
