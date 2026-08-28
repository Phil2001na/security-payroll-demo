// The working-time rules a roster edit has to satisfy, as one testable decision.
//
// These four checks already governed every manual roster edit on the Schedule screen; they
// lived inside the page component, where nothing could exercise them. The UAT confirmed the
// current rule set is complete for this scope (decision #4), so this move is deliberately
// behaviour-preserving: same checks, same order, same wording. It exists so the rules can be
// regression-tested and so the next screen that needs them reuses these instead of
// re-deriving them.
//
// Deliberately NOT here, per decision #4: any minimum rest-gap rule (an 11-hour gap between
// shifts and the like). The Night→Day / Day→Night conflict checks below are the rest
// protection this system applies, and the UAT confirmed nothing further is in scope.

// Visual/period category of a shift type, as the Schedule screen classifies it.
export type ShiftKind = "day" | "night" | "double" | "leave" | "other";

export const WEEKLY_HOUR_CAP = 60;
// One work-free calendar day per ISO week: a guard rostered six days already has it.
export const MAX_WORKING_DAYS_PER_WEEK = 6;

export type WorkingTimeRule =
  | "shift_kind_allowed"
  | "one_shift_per_date"
  | "weekly_hour_cap"
  | "weekly_rest_day"
  | "night_to_day_conflict"
  | "day_to_night_conflict";

export type ShiftPlacement = {
  // The date being rostered (YYYY-MM-DD) and the shift proposed for it.
  date: string;
  candidateKind: ShiftKind;
  candidateHours: number;
  // A leave or zero-hour shift type is not "work": it is exempt from the hour, rest-day
  // and adjacency rules, and it may sit on a date that already carries a shift.
  candidateIsWorking: boolean;
  // Hours already rostered for this employee in the candidate's ISO week, excluding any
  // assignment this edit replaces.
  weeklyHours: number;
  // Distinct dates in that ISO week the employee already works.
  workedDates: ReadonlySet<string>;
  // Shift kind already rostered per date, used for the adjacency checks. Not limited to
  // the candidate's own week — the conflict can straddle a week boundary.
  kindByDate: ReadonlyMap<string, ShiftKind>;
  // True when the employee already has a working shift on this exact date.
  alreadyRosteredOnDate: boolean;
  weeklyHourCap?: number;
  maxWorkingDaysPerWeek?: number;
};

export type WorkingTimeIssue = { rule: WorkingTimeRule; message: string };

// The wording each rule reports. Exported so callers that check a rule inline (the Schedule
// screen checks one-shift-per-date while it is already walking the week's assignments) show
// the same sentence the evaluator would.
export const WORKING_TIME_MESSAGES: Record<WorkingTimeRule, (context?: number) => string> = {
  shift_kind_allowed: () => "Only standard Day or Night shifts can be rostered here",
  one_shift_per_date: () => "Already rostered for another shift on this date",
  weekly_hour_cap: (cap = WEEKLY_HOUR_CAP) => `Would exceed the ${cap}-hour weekly cap`,
  weekly_rest_day: () => "Would remove the guard's required weekly rest day",
  night_to_day_conflict: () => "Night shift the previous day ends too close to this Day shift",
  day_to_night_conflict: () => "Day shift the next day starts too close to this Night shift",
};

function addIso(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// The first rule the placement breaks, or null when it is allowed. First — not all — because
// the caller shows one reason on one cell; `evaluateWorkingTimeRules` returns the full set.
export function evaluateShiftPlacement(placement: ShiftPlacement): WorkingTimeIssue | null {
  return evaluateWorkingTimeRules(placement)[0] ?? null;
}

export function evaluateWorkingTimeRules(placement: ShiftPlacement): WorkingTimeIssue[] {
  const cap = placement.weeklyHourCap ?? WEEKLY_HOUR_CAP;
  const maxDays = placement.maxWorkingDaysPerWeek ?? MAX_WORKING_DAYS_PER_WEEK;
  const { candidateKind, candidateIsWorking, date, kindByDate } = placement;
  const issues: WorkingTimeIssue[] = [];

  if (candidateIsWorking && candidateKind !== "day" && candidateKind !== "night") {
    issues.push({
      rule: "shift_kind_allowed",
      message: WORKING_TIME_MESSAGES.shift_kind_allowed(),
    });
  }

  // One shift per employee per calendar date (decision #3). The repository has no approved
  // exception mechanism for a second shift on one date, and this work does not add one.
  if (candidateIsWorking && placement.alreadyRosteredOnDate) {
    issues.push({
      rule: "one_shift_per_date",
      message: WORKING_TIME_MESSAGES.one_shift_per_date(),
    });
  }

  if (!candidateIsWorking) return issues;

  if (placement.weeklyHours + placement.candidateHours > cap) {
    issues.push({
      rule: "weekly_hour_cap",
      message: WORKING_TIME_MESSAGES.weekly_hour_cap(cap),
    });
  }

  if (!placement.workedDates.has(date) && placement.workedDates.size >= maxDays) {
    issues.push({
      rule: "weekly_rest_day",
      message: WORKING_TIME_MESSAGES.weekly_rest_day(),
    });
  }

  if (candidateKind === "day" && kindByDate.get(addIso(date, -1)) === "night") {
    issues.push({
      rule: "night_to_day_conflict",
      message: WORKING_TIME_MESSAGES.night_to_day_conflict(),
    });
  }

  if (candidateKind === "night" && kindByDate.get(addIso(date, 1)) === "day") {
    issues.push({
      rule: "day_to_night_conflict",
      message: WORKING_TIME_MESSAGES.day_to_night_conflict(),
    });
  }

  return issues;
}
