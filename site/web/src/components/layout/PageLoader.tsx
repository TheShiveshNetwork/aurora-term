interface PageLoaderProps {
  visible: boolean;
}

export function PageLoader({ visible }: PageLoaderProps) {
  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background transition-opacity duration-500 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-outline border-t-primary" />
    </div>
  );
}