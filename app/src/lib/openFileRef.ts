export type OpenFileFn = (
  filePath: string,
  cwd?: string,
  options?: { lineNumber?: number; matchStart?: number; matchEnd?: number },
) => string;

let openFileFn: OpenFileFn | null = null;

export function registerOpenFile(fn: OpenFileFn): void {
  openFileFn = fn;
}

export function openFileInApp(
  filePath: string,
  cwd?: string,
  options?: { lineNumber?: number; matchStart?: number; matchEnd?: number },
): string | null {
  if (!openFileFn) return null;
  return openFileFn(filePath, cwd, options);
}
