import { isImageFile, isVideoFile } from "../../../lib/fileUtils";

export enum RendererType {
  CODE = "code",
  IMAGE = "image",
  VIDEO = "video",
}

export function getRendererType(filePath: string): RendererType {
  if (isImageFile(filePath)) return RendererType.IMAGE;
  if (isVideoFile(filePath)) return RendererType.VIDEO;
  return RendererType.CODE;
}

export function isCodeFile(filePath: string): boolean {
  return getRendererType(filePath) === RendererType.CODE;
}

export function isMediaFile(filePath: string): boolean {
  const t = getRendererType(filePath);
  return t === RendererType.IMAGE || t === RendererType.VIDEO;
}
