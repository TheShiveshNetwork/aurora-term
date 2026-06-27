const SANITIZE_PATTERNS = [
  [/<\|im_start\|>/g, ""],
  [/<\|im_end\|>/g, ""],
  [/<\/?s>/g, ""],
];

export function sanitizeMessage(raw: string): string {
  let msg = raw;
  for (const [pattern, replacement] of SANITIZE_PATTERNS) {
    msg = msg.replace(pattern, replacement as string);
  }
  return msg.trim();
}
