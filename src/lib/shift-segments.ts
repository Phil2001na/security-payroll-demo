// Internal payroll segmentation for one stored shift (UAT 2026-08-20 decisions #1, #2, #8).
//
// A shift that runs past midnight stays ONE roster/attendance record — `shift_logs` keeps a
// single row with its anchor date, clock window and worked hours. Nothing here creates,
// splits or writes a second operational shift. Segmentation is a *calculation* concern: the
// engine walks the stored shift's real clock interval and cuts it at every rule boundary it
// crosses (midnight, and therefore the Sunday / public-holiday boundary) so each slice is
// paid under the day rule that actually applies to it.
//
// Worked example the client signed off on:
//   stored shift : Saturday 18:00 → Sunday 06:00 (one record, 12h)
//   segments     : Sat 18:00–24:00 (6h, ordinary) + Sun 00:00–06:00 (6h, Sunday rule)
//
// Timezone: the app stores wall-clock dates (`YYYY-MM-DD`) plus minute-of-day clock windows
// and never a UTC instant, so every calculation here is pure date/minute arithmetic. Nothing
// reads the host clock or the host timezone, which is what makes the result identical on a
// Windhoek laptop, a UTC edge runtime and a CI box in another hemisphere.

// ── Sunday boundary interpretation (decision #1) ─────────────────────────────
// The applicable interpretation is still with the client and labour counsel, so the rule is
// configuration, not a constant. The configured mode resolves a shift on its own — including
// the 6/6 tie the UAT surfaced — so there is no separate tie-breaker to set or maintain.
export type SundayBoundaryMode =
  // Cut at midnight and pay each side under its own calendar day. This is what the UAT
  // asked for and what the engine already did, so it is the default.
  | "midnight_split"
  // Labour Act s.21(8) reading: the whole shift takes the rule of the day holding the
  // majority of its minutes. Ties resolve to the higher-rate day (see MAJORITY_TIE_ORDER).
  | "majority_of_shift"
  // The whole shift takes the rule of the calendar day it started on.
  | "shift_start_day";

export const SUNDAY_BOUNDARY_MODES: readonly SundayBoundaryMode[] = [
  "midnight_split",
  "majority_of_shift",
  "shift_start_day",
];

export const DEFAULT_SUNDAY_BOUNDARY_MODE: SundayBoundaryMode = "midnight_split";

// `payroll_constants.value` is numeric, so the mode travels as a code. Keep these in step
// with the `sunday_boundary_mode` seed in
// 20260828120000_sunday_boundary_and_sunday_rate_control.sql.
export const SUNDAY_BOUNDARY_MODE_CODES: Record<SundayBoundaryMode, number> = {
  midnight_split: 0,
  majority_of_shift: 1,
  shift_start_day: 2,
};

export const SUNDAY_BOUNDARY_MODE_LABELS: Record<SundayBoundaryMode, string> = {
  midnight_split: "Split at midnight — each side paid under its own calendar day",
  majority_of_shift: "Whole shift follows the day holding most of its hours (s.21(8))",
  shift_start_day: "Whole shift follows the calendar day it started on",
};

// An unknown/absent code must never silently change how anyone is paid: fall back to the
// mode the engine has always used.
export function sundayBoundaryModeFromCode(code: unknown): SundayBoundaryMode {
  const n = Number(code);
  if (!Number.isFinite(n)) return DEFAULT_SUNDAY_BOUNDARY_MODE;
  const found = SUNDAY_BOUNDARY_MODES.find((m) => SUNDAY_BOUNDARY_MODE_CODES[m] === n);
  return found ?? DEFAULT_SUNDAY_BOUNDARY_MODE;
}

export function sundayBoundaryModeCode(mode: SundayBoundaryMode): number {
  return SUNDAY_BOUNDARY_MODE_CODES[mode];
}

// ── Day rules a segment can attract ──────────────────────────────────────────
export type SegmentDayRule = "ordinary" | "sunday" | "public_holiday";

// Which rule wins when `majority_of_shift` lands on an exact tie. Highest-paying first: a
// tie is the one case the statute does not resolve, so the shift resolves in the employee's
// favour rather than the employer's. Deterministic, and self-contained — the whole point of
// the configured mode needing no separate tie-breaker.
const MAJORITY_TIE_ORDER: readonly SegmentDayRule[] = ["public_holiday", "sunday", "ordinary"];

export const MINUTES_PER_DAY = 1440;

// Night band per Labour Act s.19 — 20h00 to 07h00. As minutes-of-day it wraps midnight:
// [1200, 1440) ∪ [0, 420).
export const NIGHT_EVENING_START = 20 * 60;
export const NIGHT_MORNING_END = 7 * 60;

export type ShiftSegment = {
  // Position in the shift, 0-based and in clock order.
  index: number;
  // Calendar date this segment falls on (YYYY-MM-DD), and how far it sits from the shift's
  // anchor date — 0 for the day the shift started, 1 for the morning after, and so on.
  date: string;
  dayOffset: number;
  dayOfWeek: number; // 0 = Sunday
  // Wall-clock window inside `date`, in minutes from that day's midnight. `endMin` is
  // exclusive, so a segment running to midnight ends at 1440 rather than starting the
  // next day at 0 — that is what keeps the boundary minute from being counted twice.
  startMin: number;
  endMin: number;
  startClock: string; // "18:00"
  endClock: string; // "24:00"
  minutes: number;
  hours: number;
  nightMinutes: number;
  // What this segment's own calendar day says, before the boundary mode is applied.
  calendarRule: SegmentDayRule;
  // What the configured boundary mode actually pays this segment under.
  appliedRule: SegmentDayRule;
  // Present only when the mode moved the segment off its own calendar rule — the audit
  // trail has to say why a Sunday segment was paid as ordinary work, or the reverse.
  ruleReason?: string;
};

export type ShiftSegmentation = {
  anchorDate: string;
  boundaryMode: SundayBoundaryMode;
  startMin: number;
  durationMinutes: number;
  // Wall-clock stamps for the stored shift — derived, never stored separately. Rendered as
  // local wall clock ("2026-08-22T18:00"), the same basis the rest of the app uses.
  startsAt: string;
  endsAt: string;
  endDate: string;
  crossesMidnight: boolean;
  midnightCrossings: number;
  segments: ShiftSegment[];
  totals: {
    minutes: number;
    ordinaryMinutes: number;
    sundayMinutes: number;
    publicHolidayMinutes: number;
    nightMinutes: number;
  };
  warnings: string[];
};

// ── Date helpers — wall-clock arithmetic, host-timezone independent ──────────
export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function dayOfWeekISO(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// 1140 → "19:00". Minute 1440 renders as "24:00" so a segment that ends at midnight reads
// as the end of its own day rather than the start of the next one.
export function clockOf(minuteOfDay: number): string {
  // Display only — rounded so a fractional worked-hours value (7.75h, 11.9h) still renders
  // a clean clock time. The segment arithmetic itself never rounds.
  const total = Math.round(minuteOfDay);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function overlap(a: number, b: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(b, hi) - Math.max(a, lo));
}

// Minutes of [startMin, endMin) that fall inside the s.19 night band.
export function nightMinutesIn(startMin: number, endMin: number): number {
  return (
    overlap(startMin, endMin, NIGHT_EVENING_START, MINUTES_PER_DAY) +
    overlap(startMin, endMin, 0, NIGHT_MORNING_END)
  );
}

function calendarRuleFor(date: string, publicHolidays: ReadonlySet<string>): SegmentDayRule {
  if (publicHolidays.has(date)) return "public_holiday";
  return dayOfWeekISO(date) === 0 ? "sunday" : "ordinary";
}

export type SegmentShiftArgs = {
  // The stored shift's anchor date — `shift_logs.date`, the day the shift started.
  anchorDate: string;
  // Clock start as minutes from the anchor date's midnight (07:00 = 420, 19:00 = 1140).
  startMin: number;
  durationMinutes: number;
  boundaryMode?: SundayBoundaryMode;
  publicHolidayDates?: ReadonlySet<string>;
  // Forces every segment onto one rule regardless of calendar day — used when the shift
  // type itself carries an explicit Sunday / public-holiday pay rule, which the operator
  // set deliberately and the boundary mode must not second-guess.
  forcedRule?: SegmentDayRule;
  forcedRuleReason?: string;
};

// Split one stored shift into the segments payroll calculates it under.
//
// Guarantees, checked by the regression suite and asserted below:
//   • segments are contiguous and non-overlapping in clock order;
//   • Σ segment.minutes === durationMinutes exactly — no minute counted twice, none lost;
//   • the stored shift is untouched: this function reads, it never writes.
export function segmentShift(args: SegmentShiftArgs): ShiftSegmentation {
  const boundaryMode = args.boundaryMode ?? DEFAULT_SUNDAY_BOUNDARY_MODE;
  const publicHolidays = args.publicHolidayDates ?? new Set<string>();
  const anchorDate = String(args.anchorDate).slice(0, 10);
  const startMin = Number(args.startMin) || 0;
  const durationMinutes = Number(args.durationMinutes) || 0;
  const warnings: string[] = [];

  const base: ShiftSegmentation = {
    anchorDate,
    boundaryMode,
    startMin,
    durationMinutes: Math.max(0, durationMinutes),
    startsAt: `${anchorDate}T${clockOf(startMin % MINUTES_PER_DAY)}`,
    endsAt: `${anchorDate}T${clockOf(startMin % MINUTES_PER_DAY)}`,
    endDate: anchorDate,
    crossesMidnight: false,
    midnightCrossings: 0,
    segments: [],
    totals: {
      minutes: 0,
      ordinaryMinutes: 0,
      sundayMinutes: 0,
      publicHolidayMinutes: 0,
      nightMinutes: 0,
    },
    warnings,
  };

  // A zero- or negative-duration shift has nothing to pay and nothing to split. It is
  // reported rather than thrown so one bad attendance row can't fail a whole payroll run.
  if (!(durationMinutes > 0)) {
    if (durationMinutes < 0) {
      warnings.push(
        `Shift on ${anchorDate} has a negative duration (${durationMinutes} min) — treated as zero`,
      );
    }
    return base;
  }

  // 1. Cut at every midnight the shift crosses. This always happens, whatever the boundary
  //    mode: the mode decides how a segment is *paid*, never whether it is *shown*.
  const absoluteEnd = startMin + durationMinutes;
  const rawSegments: Array<Omit<ShiftSegment, "index" | "appliedRule" | "ruleReason">> = [];
  let cursor = startMin;
  while (cursor < absoluteEnd) {
    const dayOffset = Math.floor(cursor / MINUTES_PER_DAY);
    const dayStartAbs = dayOffset * MINUTES_PER_DAY;
    const segmentEndAbs = Math.min(absoluteEnd, dayStartAbs + MINUTES_PER_DAY);
    const segStart = cursor - dayStartAbs;
    const segEnd = segmentEndAbs - dayStartAbs;
    const date = addDaysISO(anchorDate, dayOffset);
    rawSegments.push({
      date,
      dayOffset,
      dayOfWeek: dayOfWeekISO(date),
      startMin: segStart,
      endMin: segEnd,
      startClock: clockOf(segStart),
      endClock: clockOf(segEnd),
      minutes: segmentEndAbs - cursor,
      hours: (segmentEndAbs - cursor) / 60,
      nightMinutes: nightMinutesIn(segStart, segEnd),
      calendarRule: calendarRuleFor(date, publicHolidays),
    });
    cursor = segmentEndAbs;
  }

  // 2. Resolve the rule each segment is actually paid under.
  let ruleFor: (segment: (typeof rawSegments)[number]) => {
    rule: SegmentDayRule;
    reason?: string;
  };

  if (args.forcedRule) {
    const forced = args.forcedRule;
    const reason =
      args.forcedRuleReason ?? `Shift type pay rule fixes the whole shift to ${forced}`;
    ruleFor = (segment) => ({
      rule: forced,
      reason: segment.calendarRule === forced ? undefined : reason,
    });
  } else if (boundaryMode === "midnight_split") {
    ruleFor = (segment) => ({ rule: segment.calendarRule });
  } else if (boundaryMode === "shift_start_day") {
    const startRule = rawSegments[0].calendarRule;
    ruleFor = (segment) => ({
      rule: startRule,
      reason:
        segment.calendarRule === startRule
          ? undefined
          : `Boundary mode "shift_start_day": whole shift follows ${rawSegments[0].date} (${startRule})`,
    });
  } else {
    // majority_of_shift — tally minutes per calendar rule, then apply the winner to the
    // whole shift. The tie order is fixed, so no separate tie-breaker is configured.
    const byRule = new Map<SegmentDayRule, number>();
    for (const segment of rawSegments) {
      byRule.set(segment.calendarRule, (byRule.get(segment.calendarRule) ?? 0) + segment.minutes);
    }
    let winner: SegmentDayRule = rawSegments[0].calendarRule;
    let best = -1;
    let tied = false;
    for (const rule of MAJORITY_TIE_ORDER) {
      const minutes = byRule.get(rule) ?? 0;
      if (minutes > best) {
        best = minutes;
        winner = rule;
        tied = false;
      } else if (minutes === best && minutes > 0) {
        // MAJORITY_TIE_ORDER is walked highest-rate first, so the incumbent already is
        // the tie winner; only record that the tie happened.
        tied = true;
      }
    }
    if (tied) {
      warnings.push(
        `Shift on ${anchorDate} splits evenly across day rules — "majority_of_shift" resolved it to ${winner} (highest-rate day)`,
      );
    }
    const reason = `Boundary mode "majority_of_shift": ${best} of ${durationMinutes} min fall on ${winner}${tied ? " (tie resolved to the highest-rate day)" : ""}`;
    ruleFor = (segment) => ({
      rule: winner,
      reason: segment.calendarRule === winner ? undefined : reason,
    });
  }

  const segments: ShiftSegment[] = rawSegments.map((segment, index) => {
    const { rule, reason } = ruleFor(segment);
    return { ...segment, index, appliedRule: rule, ...(reason ? { ruleReason: reason } : {}) };
  });

  const totals = {
    minutes: 0,
    ordinaryMinutes: 0,
    sundayMinutes: 0,
    publicHolidayMinutes: 0,
    nightMinutes: 0,
  };
  for (const segment of segments) {
    totals.minutes += segment.minutes;
    totals.nightMinutes += segment.nightMinutes;
    if (segment.appliedRule === "sunday") totals.sundayMinutes += segment.minutes;
    else if (segment.appliedRule === "public_holiday")
      totals.publicHolidayMinutes += segment.minutes;
    else totals.ordinaryMinutes += segment.minutes;
  }

  // The whole point of segmenting is that the pieces still add up to the stored shift. If
  // they ever don't, say so loudly in the breakdown rather than quietly mispaying someone.
  if (totals.minutes !== durationMinutes) {
    warnings.push(
      `Segment total ${totals.minutes} min does not equal the stored shift duration ${durationMinutes} min on ${anchorDate}`,
    );
  }

  const lastSegment = segments[segments.length - 1];
  return {
    ...base,
    durationMinutes,
    endDate: lastSegment.date,
    endsAt: `${lastSegment.date}T${clockOf(lastSegment.endMin % MINUTES_PER_DAY)}`,
    crossesMidnight: segments.length > 1,
    midnightCrossings: segments.length - 1,
    segments,
    totals,
    warnings,
  };
}

// Compact, human-readable form of a segment for the payroll breakdown and audit trail.
export function describeSegment(segment: ShiftSegment): string {
  const hours = segment.hours.toFixed(2).replace(/\.00$/, "");
  return `${segment.date} ${segment.startClock}–${segment.endClock} (${hours}h, ${segment.appliedRule})`;
}
