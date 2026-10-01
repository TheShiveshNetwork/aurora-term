import React, { useMemo } from "react";
import { getRendererType, RendererType } from "../fileRendererFactory";
import { ImageRenderer } from "./ImageRenderer";
import { VideoRenderer } from "./VideoRenderer";

interface MediaRendererProps {
  filePath: string;
  fileName: string;
}

export function MediaRenderer({ filePath, fileName }: MediaRendererProps) {
  const type = useMemo(() => getRendererType(filePath), [filePath]);

  if (type === RendererType.IMAGE) {
    return <ImageRenderer filePath={filePath} fileName={fileName} />;
  }
  if (type === RendererType.VIDEO) {
    return <VideoRenderer filePath={filePath} fileName={fileName} />;
  }
  return null;
}
