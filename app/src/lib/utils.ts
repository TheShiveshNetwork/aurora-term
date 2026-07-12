export function cn(...inputs: any[]): string {
  const classes = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === 'string') {
      classes.push(input);
    } else if (Array.isArray(input)) {
      const resolved = cn(...input);
      if (resolved) classes.push(resolved);
    } else if (typeof input === 'object') {
      for (const key in input) {
        if (input[key]) {
          classes.push(key);
        }
      }
    }
  }
  return classes.join(' ');
}

export function formatTauriError(err: any): string {
  if (typeof err === "string") return err;
  if (!err) return "Unknown error";

  // Standard JS Error object
  if (typeof err.message === "string") return err.message;

  // Externally tagged Rust AppError enum (e.g. { Sidecar: "error message" })
  if (typeof err === "object") {
    const keys = Object.keys(err);
    if (keys.length > 0) {
      const val = err[keys[0]];
      if (typeof val === "string") {
        return val;
      }
      if (val && typeof val === "object" && typeof (val as any).message === "string") {
        return (val as any).message;
      }
      try {
        return JSON.stringify(err);
      } catch {
        // ignore
      }
    }
  }

  // Fallback
  const str = String(err);
  if (str === "[object Object]") {
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown error";
    }
  }
  return str;
}

