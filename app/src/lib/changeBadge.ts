/**
 * Change-kind badge for the "Files Modified" list.
 *
 * W/M come from the tool the agent invoked. D cannot be derived that way — no
 * tool reports a deletion — so it comes from the file being absent on disk,
 * which the caller checks asynchronously.
 */

export type ChangeBadge = {
  letter: "A" | "M" | "D";
  label: "Added" | "Modified" | "Deleted";
  tone: string;
};

const KINDS: Record<ChangeBadge["label"], { letter: ChangeBadge["letter"]; tone: string }> = {
  Added: { letter: "A", tone: "text-emerald-400 bg-emerald-500/10" },
  Modified: { letter: "M", tone: "text-amber-400 bg-amber-500/10" },
  Deleted: { letter: "D", tone: "text-red-400 bg-red-500/10" },
};

export function changeBadge(
  change: { type?: "write" | "patch" },
  isMissing: boolean,
): ChangeBadge {
  const label: ChangeBadge["label"] = isMissing
    ? "Deleted"
    : change.type === "patch"
      ? "Modified"
      : "Added";
  return { letter: KINDS[label].letter, label, tone: KINDS[label].tone };
}
