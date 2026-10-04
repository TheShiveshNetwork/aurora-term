/** Groups session rows into the recency buckets used by the agent view sidebar. */

export type SessionGroupLabel =
  | "Today"
  | "Yesterday"
  | "This Week"
  | "Last Week"
  | "Last Month"
  | "Last Year"
  | "Older than a year";

export interface SessionGroup<T> {
  label: SessionGroupLabel;
  items: T[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const BUCKETS: Array<{ label: SessionGroupLabel; maxDays: number }> = [
  { label: "Today", maxDays: 0 },
  { label: "Yesterday", maxDays: 1 },
  { label: "This Week", maxDays: 6 },
  { label: "Last Week", maxDays: 13 },
  { label: "Last Month", maxDays: 29 },
  { label: "Last Year", maxDays: 364 },
];

/**
 * Days since the given timestamp's calendar date.
 *
 * Uses the local calendar fields projected through `Date.UTC` rather than
 * dividing elapsed milliseconds by 24h: on a DST boundary two consecutive local
 * midnights are 23 or 25 hours apart, which would floor into the wrong bucket.
 */
export function calendarDaysAgo(timestamp: number, now = Date.now()): number {
  const date = new Date(timestamp);
  const target = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const reference = new Date(now);
  const base = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate());
  return Math.round((base - target) / DAY_MS);
}

export function sessionGroupLabel(timestamp: number, now = Date.now()): SessionGroupLabel {
  const days = calendarDaysAgo(timestamp, now);
  for (const bucket of BUCKETS) {
    if (days <= bucket.maxDays) return bucket.label;
  }
  return "Older than a year";
}

const ORDER: SessionGroupLabel[] = [
  "Today",
  "Yesterday",
  "This Week",
  "Last Week",
  "Last Month",
  "Last Year",
  "Older than a year",
];

/**
 * Splits sessions into recency buckets, newest bucket first. `getTimestamp`
 * should be the session's creation time — it is stable, whereas "last modified"
 * drifts whenever the UI touches run state. Within a bucket, sessions are
 * ordered by the same timestamp descending.
 */
export function groupSessionsByRecency<T>(
  items: T[],
  getTimestamp: (item: T) => number,
  now = Date.now(),
): Array<SessionGroup<T>> {
  const buckets = new Map<SessionGroupLabel, T[]>();
  for (const item of items) {
    const label = sessionGroupLabel(getTimestamp(item), now);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(item);
    else buckets.set(label, [item]);
  }
  return ORDER.filter((label) => buckets.has(label)).map((label) => ({
    label,
    items: buckets.get(label)!.sort((a, b) => getTimestamp(b) - getTimestamp(a)),
  }));
}

export function formatSessionSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
