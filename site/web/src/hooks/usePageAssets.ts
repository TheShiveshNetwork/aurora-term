import { useEffect } from "react";
import { expectBackground, releaseBackground } from "../lib/pageLoad";

export function useExpectBackground() {
  useEffect(() => {
    expectBackground();
    return releaseBackground;
  }, []);
}