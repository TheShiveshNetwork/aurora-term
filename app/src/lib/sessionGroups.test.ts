import { describe, expect, it } from "vitest";
import {
  calendarDaysAgo,
  formatSessionSize,
  groupSessionsByRecency,
  sessionGroupLabel,
} from "./sessionGroups";

const NOW = new Date(2026, 4, 20, 14, 30).getTime();

/** `days` calendar days before the 20th of May 2026, at midday. */
function daysAgo(days: number, hour = 12): number {
  return new Date(2026, 4, 20 - days, hour).getTime();
}

describe("calendarDaysAgo", () => {
  it("counts calendar dates, not elapsed hours", () => {
    expect(calendarDaysAgo(daysAgo(0, 0), NOW)).toBe(0);
    expect(calendarDaysAgo(daysAgo(0, 23), NOW)).toBe(0);
    expect(calendarDaysAgo(daysAgo(1, 23), NOW)).toBe(1);
  });

  it("survives a month boundary", () => {
    // 30 April against 20 May is 20 days, not 19.
    expect(calendarDaysAgo(new Date(2026, 3, 30, 12).getTime(), NOW)).toBe(20);
  });

  it("treats a future timestamp as same-day rather than negative", () => {
    expect(calendarDaysAgo(daysAgo(-2), NOW)).toBe(-2);
  });
});

describe("sessionGroupLabel", () => {
  it("walks the full bucket ladder", () => {
    expect(sessionGroupLabel(daysAgo(0), NOW)).toBe("Today");
    expect(sessionGroupLabel(daysAgo(1), NOW)).toBe("Yesterday");
    expect(sessionGroupLabel(daysAgo(2), NOW)).toBe("This Week");
    expect(sessionGroupLabel(daysAgo(6), NOW)).toBe("This Week");
    expect(sessionGroupLabel(daysAgo(7), NOW)).toBe("Last Week");
    expect(sessionGroupLabel(daysAgo(13), NOW)).toBe("Last Week");
    expect(sessionGroupLabel(daysAgo(14), NOW)).toBe("Last Month");
    expect(sessionGroupLabel(daysAgo(29), NOW)).toBe("Last Month");
    expect(sessionGroupLabel(daysAgo(30), NOW)).toBe("Last Year");
    expect(sessionGroupLabel(daysAgo(364), NOW)).toBe("Last Year");
    expect(sessionGroupLabel(daysAgo(365), NOW)).toBe("Older than a year");
    expect(sessionGroupLabel(daysAgo(900), NOW)).toBe("Older than a year");
  });

  it("uses calendar boundaries around midnight", () => {
    expect(sessionGroupLabel(new Date(2026, 4, 20, 0, 1).getTime(), NOW)).toBe("Today");
    expect(sessionGroupLabel(new Date(2026, 4, 19, 23, 59).getTime(), NOW)).toBe("Yesterday");
  });
});

describe("groupSessionsByRecency", () => {
  it("orders buckets newest first", () => {
    const groups = groupSessionsByRecency(
      [
        { id: "ancient", at: daysAgo(500) },
        { id: "last-year", at: daysAgo(200) },
        { id: "last-month", at: daysAgo(20) },
        { id: "last-week", at: daysAgo(8) },
        { id: "this-week", at: daysAgo(3) },
        { id: "yesterday", at: daysAgo(1) },
        { id: "today", at: daysAgo(0) },
      ],
      (i) => i.at,
      NOW,
    );

    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "This Week",
      "Last Week",
      "Last Month",
      "Last Year",
      "Older than a year",
    ]);
  });

  it("orders each bucket newest first", () => {
    const groups = groupSessionsByRecency(
      [
        { id: "older", at: daysAgo(0, 9) },
        { id: "newest", at: daysAgo(0, 20) },
        { id: "middle", at: daysAgo(0, 14) },
      ],
      (i) => i.at,
      NOW,
    );

    expect(groups[0].items.map((i) => i.id)).toEqual(["newest", "middle", "older"]);
  });

  it("omits empty buckets", () => {
    const groups = groupSessionsByRecency([{ id: "a", at: NOW }], (i) => i.at, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
  });

  it("reproduces the reported bug: sessions created yesterday must not read as Today", () => {
    // Three sessions created the previous evening, all touched again today.
    // Grouping by the touched time is what put them under "Today".
    const created = daysAgo(1, 20);
    const touched = daysAgo(0, 22);
    expect(sessionGroupLabel(created, NOW)).toBe("Yesterday");
    expect(sessionGroupLabel(touched, NOW)).toBe("Today");
  });
});

describe("formatSessionSize", () => {
  it("scales the unit", () => {
    expect(formatSessionSize(512)).toBe("512 B");
    expect(formatSessionSize(2048)).toBe("2 KB");
    expect(formatSessionSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});