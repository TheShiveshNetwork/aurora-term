import { useEffect } from "react";
import { trackPageView } from "../lib/analytics";

export function usePageViewTracking(pathname: string): void {
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);
}
