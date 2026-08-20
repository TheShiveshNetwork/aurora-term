import SpecularButton from "./SpecularButton";

type Variant = "primary" | "ghost";

interface AuroraButtonProps {
  children: React.ReactNode;
  variant?: Variant;
  href?: string;
  external?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
}

const themes: Record<Variant, Record<string, string | number>> = {
  primary: {
    tint: "#4F8CFF",
    tintOpacity: 0.18,
    textColor: "#EAF1FF",
    lineColor: "#9bc1ff",
    baseColor: "#16223B",
    blur: 6,
  },
  ghost: {
    tint: "#ffffff",
    tintOpacity: 0,
    textColor: "#E8EAF0",
    lineColor: "#cfe0ff",
    baseColor: "#1b2436",
    blur: 6,
  },
};

export function AuroraButton({
  children,
  variant = "primary",
  href,
  external,
  size = "lg",
  className,
  onClick,
}: AuroraButtonProps) {
  const theme = themes[variant];
  return (
    <SpecularButton
      href={href}
      external={external}
      size={size}
      className={className}
      onClick={onClick}
      tint={theme.tint as string}
      tintOpacity={theme.tintOpacity as number}
      textColor={theme.textColor as string}
      lineColor={theme.lineColor as string}
      baseColor={theme.baseColor as string}
      blur={theme.blur as number}
    >
      {children}
    </SpecularButton>
  );
}
