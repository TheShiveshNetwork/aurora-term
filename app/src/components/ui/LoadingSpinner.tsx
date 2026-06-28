import { Loader } from "lucide-react";

interface LoadingSpinnerProps {
  size?: number;
  text?: string;
  inline?: boolean;
  className?: string;
}

export function LoadingSpinner({
  size = 24,
  text,
  inline = false,
  className = "",
}: LoadingSpinnerProps) {
  const cls = inline ? "text-current" : "text-primary";
  const spinner = (
    <div className={"flex items-center gap-2" + (inline ? "" : " justify-center")}>
      <Loader size={size} className={"animate-spin " + cls + " " + className} />
      {text && <span className={"text-xs " + (inline ? "text-current" : "text-on-surface-variant")}>{text}</span>}
    </div>
  );

  if (inline) return spinner;

  return (
    <div className="flex items-center justify-center h-full w-full bg-surface-container-low">
      {spinner}
    </div>
  );
}