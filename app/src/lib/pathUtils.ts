export function relativePath(absPath: string, basePath: string): string {
  const normalizedBase = basePath.replace(/[\\/]+$/, "");
  const result = absPath.replace(normalizedBase, "").replace(/^[/\\]/, "");
  return result || ".";
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}
