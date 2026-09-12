import { useEffect } from "react";
import {
  expectBackground,
  releaseBackground,
  expectVideo,
  releaseVideo,
} from "../lib/pageLoad";

export function useExpectBackground() {
  useEffect(() => {
    expectBackground();
    return releaseBackground;
  }, []);
}

export function useExpectVideo() {
  useEffect(() => {
    expectVideo();
    return releaseVideo;
  }, []);
}