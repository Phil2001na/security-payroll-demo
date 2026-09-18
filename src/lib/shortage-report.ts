// UAT-10 — the weekly Operations/HR shortage report.
//
// Decision §8 of DECISIONS-2026-09-03.md: shortage reporting only, no applicant pipeline.
// Group recurring shortages by site, shift and required skill so HR can see where to recruit.
//
// The whole point is the word "recurring". One unfilled Tuesday night is an incident someone
// covered by phone. The same Tuesday night unfilled for six weeks is a vacancy. Only the
// second one is a reason to hire, so this module's job is telling them apart.

export type WeeklyShortageRow = {
  week_start: string;
  site_id: string;
  site_name: string;
  shift_kind: string;
  required_grade: string;
  occurrences: number;
  days_affected: number;
  total_unmet: number;
};

/** A site + shift + required-grade combination, summarised across the whole window. */
export type ShortagePattern = {
  key: string;
  siteId: string;
  siteName: string;
  shiftKind: string;
  requiredGrade: string;
  /** Distinct weeks this combination went short. The recruitment signal. */
  weeksAffected: number;
  daysAffected: number;
  totalUnmet: number;
  firstWeek: string;
  lastWeek: string;
  recurring: boolean;
};

/**
 * A combination is "recurring" once it has gone short in more than one week. Two is the
 * smallest number that can distinguish a pattern from an incident, and setting the bar
 * higher would hide a gap that has already repeated.
 */
export const RECURRING_WEEK_THRESHOLD = 2;

export function patternKey(row: {
  site_id: string;
  shift_kind: string;
  required_grade: string;
}): string {
  return `${row.site_id}|${row.shift_kind}|${row.required_grade}`;
}

/**
 * Rolls weekly rows up into one row per site + shift + grade, ordered with the worst
 * recruitment problem first: recurring before one-off, then by how many weeks it has run,
 * then by how many guard-shifts went unfilled.
 */
export function summarisePatterns(rows: WeeklyShortageRow[]): ShortagePattern[] {
  const byKey = new Map<string, ShortagePattern & { weeks: Set<string> }>();

  for (const r of rows) {
    const key = patternKey(r);
    const existing = byKey.get(key);
    if (existing) {
      existing.weeks.add(r.week_start);
      existing.daysAffected += r.days_affected;
      existing.totalUnmet += r.total_unmet;
      if (r.week_start < existing.firstWeek) existing.firstWeek = r.week_start;
      if (r.week_start > existing.lastWeek) existing.lastWeek = r.week_start;
    } else {
      byKey.set(key, {
        key,
        siteId: r.site_id,
        siteName: r.site_name,
        shiftKind: r.shift_kind,
        requiredGrade: r.required_grade,
        weeks: new Set([r.week_start]),
        weeksAffected: 0,
        daysAffected: r.days_affected,
        totalUnmet: r.total_unmet,
        firstWeek: r.week_start,
        lastWeek: r.week_start,
        recurring: false,
      });
    }
  }

  return [...byKey.values()]
    .map(({ weeks, ...p }) => ({
      ...p,
      weeksAffected: weeks.size,
      recurring: weeks.size >= RECURRING_WEEK_THRESHOLD,
    }))
    .sort(
      (a, b) =>
        Number(b.recurring) - Number(a.recurring) ||
        b.weeksAffected - a.weeksAffected ||
        b.totalUnmet - a.totalUnmet ||
        a.siteName.localeCompare(b.siteName),
    );
}

/** A one-line read for someone who will not open the table. */
export function describePattern(p: ShortagePattern): string {
  const shift = p.shiftKind === "night" ? "night" : "day";
  const grade = p.requiredGrade === "Any" ? "" : ` (grade ${p.requiredGrade} required)`;
  if (!p.recurring) {
    return `${p.siteName}${grade} went short on ${shift} shifts once, in the week of ${p.firstWeek}.`;
  }
  return `${p.siteName}${grade} has gone short on ${shift} shifts in ${p.weeksAffected} separate weeks, ${p.totalUnmet} guard-shifts unfilled.`;
}

export type ShortageTotals = {
  patterns: number;
  recurring: number;
  totalUnmet: number;
  sites: number;
};

export function shortageTotals(patterns: ShortagePattern[]): ShortageTotals {
  return {
    patterns: patterns.length,
    recurring: patterns.filter((p) => p.recurring).length,
    totalUnmet: patterns.reduce((sum, p) => sum + p.totalUnmet, 0),
    sites: new Set(patterns.map((p) => p.siteId)).size,
  };
}

/** The export Ops and HR actually circulate. One row per pattern, worst first. */
export function shortageCsvRows(patterns: ShortagePattern[]): Record<string, string | number>[] {
  return patterns.map((p) => ({
    Site: p.siteName,
    Shift: p.shiftKind,
    "Required grade": p.requiredGrade,
    Recurring: p.recurring ? "Yes" : "No",
    "Weeks affected": p.weeksAffected,
    "Days affected": p.daysAffected,
    "Guard-shifts unfilled": p.totalUnmet,
    "First week": p.firstWeek,
    "Last week": p.lastWeek,
  }));
}
