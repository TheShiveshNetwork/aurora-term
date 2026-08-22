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

// Human-readable elapsed time: seconds, then "Nm Ns", then "Nh Nm".
// Always renders at least "0s" so a finished turn never shows blank.
export function formatDuration(ms: number | undefined | null): string {
  if (!ms || ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
}

