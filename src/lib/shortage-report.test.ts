import { describe, expect, it } from "vitest";
import {
  RECURRING_WEEK_THRESHOLD,
  describePattern,
  patternKey,
  shortageCsvRows,
  shortageTotals,
  summarisePatterns,
  type WeeklyShortageRow,
} from "./shortage-report";

const row = (over: Partial<WeeklyShortageRow> = {}): WeeklyShortageRow => ({
  week_start: "2027-03-01",
  site_id: "s1",
  site_name: "Gate 4",
  shift_kind: "night",
  required_grade: "Any",
  occurrences: 1,
  days_affected: 1,
  total_unmet: 2,
  ...over,
});

describe("rolling weekly shortages up into patterns", () => {
  it("returns nothing for no shortages", () => {
    expect(summarisePatterns([])).toEqual([]);
  });

  it("treats one week as an incident, not a vacancy", () => {
    const [p] = summarisePatterns([row()]);
    expect(p.weeksAffected).toBe(1);
    expect(p.recurring).toBe(false);
  });

  it("treats the same site, shift and grade in two weeks as recurring", () => {
    const patterns = summarisePatterns([
      row({ week_start: "2027-03-01" }),
      row({ week_start: "2027-03-08" }),
    ]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].weeksAffected).toBe(2);
    expect(patterns[0].recurring).toBe(true);
  });

  it("does not double-count two shortages inside the same week", () => {
    // Two separate rows for one week is still one week of recurrence.
    const patterns = summarisePatterns([
      row({ week_start: "2027-03-01", days_affected: 1, total_unmet: 2 }),
      row({ week_start: "2027-03-01", days_affected: 2, total_unmet: 3 }),
    ]);
    expect(patterns[0].weeksAffected).toBe(1);
    expect(patterns[0].recurring).toBe(false);
    expect(patterns[0].daysAffected).toBe(3);
    expect(patterns[0].totalUnmet).toBe(5);
  });

  it("keeps day and night at the same site apart", () => {
    const patterns = summarisePatterns([row({ shift_kind: "day" }), row({ shift_kind: "night" })]);
    expect(patterns).toHaveLength(2);
  });

  it("keeps different sites apart", () => {
    const patterns = summarisePatterns([
      row({ site_id: "s1", site_name: "Gate 4" }),
      row({ site_id: "s2", site_name: "Depot" }),
    ]);
    expect(patterns).toHaveLength(2);
  });

  it("keeps different required grades apart", () => {
    // A site that changed its grade requirement is two different recruitment problems.
    const patterns = summarisePatterns([
      row({ required_grade: "Any" }),
      row({ required_grade: "B" }),
    ]);
    expect(patterns).toHaveLength(2);
  });

  it("tracks the first and last week it went short", () => {
    const [p] = summarisePatterns([
      row({ week_start: "2027-03-15" }),
      row({ week_start: "2027-03-01" }),
      row({ week_start: "2027-03-08" }),
    ]);
    expect(p.firstWeek).toBe("2027-03-01");
    expect(p.lastWeek).toBe("2027-03-15");
  });

  it("sums unfilled guard-shifts across every week", () => {
    const [p] = summarisePatterns([
      row({ week_start: "2027-03-01", total_unmet: 2 }),
      row({ week_start: "2027-03-08", total_unmet: 5 }),
    ]);
    expect(p.totalUnmet).toBe(7);
  });

  it("puts recurring patterns above one-offs however big the one-off is", () => {
    // A single catastrophic week is still not a recruitment signal; two bad weeks are.
    const patterns = summarisePatterns([
      row({ site_id: "big", site_name: "Big", week_start: "2027-03-01", total_unmet: 99 }),
      row({ site_id: "rec", site_name: "Rec", week_start: "2027-03-01", total_unmet: 1 }),
      row({ site_id: "rec", site_name: "Rec", week_start: "2027-03-08", total_unmet: 1 }),
    ]);
    expect(patterns[0].siteId).toBe("rec");
    expect(patterns[0].recurring).toBe(true);
    expect(patterns[1].siteId).toBe("big");
  });

  it("orders recurring patterns by how many weeks they have run", () => {
    const patterns = summarisePatterns([
      row({ site_id: "a", site_name: "A", week_start: "2027-03-01" }),
      row({ site_id: "a", site_name: "A", week_start: "2027-03-08" }),
      row({ site_id: "b", site_name: "B", week_start: "2027-03-01" }),
      row({ site_id: "b", site_name: "B", week_start: "2027-03-08" }),
      row({ site_id: "b", site_name: "B", week_start: "2027-03-15" }),
    ]);
    expect(patterns[0].siteId).toBe("b");
    expect(patterns[0].weeksAffected).toBe(3);
  });

  it("keys a pattern on site, shift and grade together", () => {
    expect(patternKey({ site_id: "s1", shift_kind: "night", required_grade: "B" })).toBe(
      "s1|night|B",
    );
  });

  it("uses two weeks as the recurrence bar", () => {
    expect(RECURRING_WEEK_THRESHOLD).toBe(2);
  });
});

describe("describing a pattern in one line", () => {
  it("says 'once' for a one-off and names the week", () => {
    const [p] = summarisePatterns([row({ week_start: "2027-03-01" })]);
    expect(describePattern(p)).toBe(
      "Gate 4 went short on night shifts once, in the week of 2027-03-01.",
    );
  });

  it("counts the weeks and the unfilled shifts for a recurring one", () => {
    const [p] = summarisePatterns([
      row({ week_start: "2027-03-01", total_unmet: 2 }),
      row({ week_start: "2027-03-08", total_unmet: 3 }),
    ]);
    expect(describePattern(p)).toBe(
      "Gate 4 has gone short on night shifts in 2 separate weeks, 5 guard-shifts unfilled.",
    );
  });

  it("names the required grade only when the site demands one", () => {
    const [any] = summarisePatterns([row({ required_grade: "Any" })]);
    expect(describePattern(any)).not.toContain("grade");

    const [graded] = summarisePatterns([row({ required_grade: "B" })]);
    expect(describePattern(graded)).toContain("grade B required");
  });
});

describe("the headline totals", () => {
  it("counts patterns, recurring ones, sites and unfilled shifts", () => {
    const totals = shortageTotals(
      summarisePatterns([
        row({ site_id: "a", site_name: "A", week_start: "2027-03-01", total_unmet: 1 }),
        row({ site_id: "a", site_name: "A", week_start: "2027-03-08", total_unmet: 1 }),
        row({ site_id: "b", site_name: "B", week_start: "2027-03-01", total_unmet: 4 }),
      ]),
    );
    expect(totals).toEqual({ patterns: 2, recurring: 1, totalUnmet: 6, sites: 2 });
  });

  it("is all zeroes when nothing went short", () => {
    expect(shortageTotals([])).toEqual({ patterns: 0, recurring: 0, totalUnmet: 0, sites: 0 });
  });
});

describe("the export", () => {
  it("flattens each pattern into one spreadsheet row", () => {
    const [csv] = shortageCsvRows(
      summarisePatterns([
        row({ week_start: "2027-03-01", required_grade: "B", total_unmet: 2 }),
        row({ week_start: "2027-03-08", required_grade: "B", total_unmet: 3 }),
      ]),
    );
    expect(csv.Site).toBe("Gate 4");
    expect(csv.Shift).toBe("night");
    expect(csv["Required grade"]).toBe("B");
    expect(csv.Recurring).toBe("Yes");
    expect(csv["Weeks affected"]).toBe(2);
    expect(csv["Guard-shifts unfilled"]).toBe(5);
    expect(csv["First week"]).toBe("2027-03-01");
    expect(csv["Last week"]).toBe("2027-03-08");
  });

  it("marks a one-off as not recurring rather than leaving it blank", () => {
    const [csv] = shortageCsvRows(summarisePatterns([row()]));
    expect(csv.Recurring).toBe("No");
  });

  it("exports nothing for nothing", () => {
    expect(shortageCsvRows([])).toEqual([]);
  });
});
