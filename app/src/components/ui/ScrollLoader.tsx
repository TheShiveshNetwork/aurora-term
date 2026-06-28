import { useEffect, useRef } from "react";
import { LoadingSpinner } from "./LoadingSpinner";

interface ScrollLoaderProps {
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  children?: React.ReactNode;
  className?: string;
  threshold?: number;
  loaderText?: string;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

export function ScrollLoader({
  loading,
  hasMore,
  onLoadMore,
  children,
  className = "",
  threshold = 160,
  loaderText = "Loading more...",
  scrollContainerRef,
}: ScrollLoaderProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          onLoadMore();
        }
      },
      {
        root: scrollContainerRef?.current ?? null,
        rootMargin: `0px 0px ${threshold}px 0px`,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore, threshold, scrollContainerRef]);

  return (
    <div className={className}>
      {children}
      {hasMore && <div ref={sentinelRef} />}
      {loading && (
        <div className="py-3 flex justify-center">
          <LoadingSpinner size={14} text={loaderText} inline />
        </div>
      )}
    </div>
  );
}
