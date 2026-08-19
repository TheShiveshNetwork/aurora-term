const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico"]);

export function isImageFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

// Normalize a filesystem path or `file://` URI into a canonical form for
// equality checks: forward slashes, no `file://` scheme, and a lowercased
// Windows drive letter. This makes comparisons robust to the casing/slash
// differences language servers emit in `file://` URIs versus the OS path we
// originally opened the file with.
export function normalizePath(p: string): string {
  let s = p.trim();
  if (s.startsWith("file://")) {
    s = s.slice("file://".length).replace(/^\/+/, "");
  }
  s = s.replace(/\\/g, "/");
  s = s.replace(/^([a-zA-Z]):/, (_m, d: string) => d.toLowerCase() + ":");
  return s;
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}
