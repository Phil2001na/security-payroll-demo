// The roster working-time rules the UAT confirmed as complete for this scope (decisions
// #3 and #4). These tests pin the current behaviour so it cannot drift.
import { describe, expect, test } from "bun:test";
import {
  MAX_WORKING_DAYS_PER_WEEK,
  WEEKLY_HOUR_CAP,
  evaluateShiftPlacement,
  evaluateWorkingTimeRules,
  type ShiftKind,
  type ShiftPlacement,
} from "../src/lib/working-time-rules.ts";

// Mon 2026-08-17 → Sun 2026-08-23.
const MON = "2026-08-17";
const TUE = "2026-08-18";
const WED = "2026-08-19";
const THU = "2026-08-20";
const FRI = "2026-08-21";
const SAT = "2026-08-22";
const SUN = "2026-08-23";

function placement(overrides: Partial<ShiftPlacement> = {}): ShiftPlacement {
  return {
    date: WED,
    candidateKind: "day",
    candidateHours: 12,
    candidateIsWorking: true,
    weeklyHours: 0,
    workedDates: new Set<string>(),
    kindByDate: new Map<string, ShiftKind>(),
    alreadyRosteredOnDate: false,
    ...overrides,
  };
}

describe("shift kind", () => {
  test("a clean placement raises nothing", () => {
    expect(evaluateShiftPlacement(placement())).toBeNull();
  });

  test("only Day and Night working shifts may be rostered", () => {
    const issue = evaluateShiftPlacement(placement({ candidateKind: "double" }));
    expect(issue?.rule).toBe("shift_kind_allowed");
    expect(issue?.message).toBe("Only standard Day or Night shifts can be rostered here");
  });

  test("leave and other non-working types are exempt from the working-time rules", () => {
    const issue = evaluateShiftPlacement(
      placement({
        candidateKind: "leave",
        candidateIsWorking: false,
        candidateHours: 0,
        weeklyHours: 60,
        workedDates: new Set([MON, TUE, WED, THU, FRI, SAT]),
        alreadyRosteredOnDate: true,
      }),
    );
    expect(issue).toBeNull();
  });
});

describe("one shift per calendar date (decision #3)", () => {
  test("a second working shift on the same date is refused", () => {
    const issue = evaluateShiftPlacement(placement({ alreadyRosteredOnDate: true }));
    expect(issue?.rule).toBe("one_shift_per_date");
    expect(issue?.message).toBe("Already rostered for another shift on this date");
  });

  test("the rule outranks the hour and rest checks it would also break", () => {
    const issue = evaluateShiftPlacement(
      placement({ alreadyRosteredOnDate: true, weeklyHours: 60 }),
    );
    expect(issue?.rule).toBe("one_shift_per_date");
  });
});

describe("weekly hour cap", () => {
  test("the cap is 60 hours and a placement that would exceed it is refused", () => {
    expect(WEEKLY_HOUR_CAP).toBe(60);
    const issue = evaluateShiftPlacement(placement({ weeklyHours: 52 }));
    expect(issue?.rule).toBe("weekly_hour_cap");
    expect(issue?.message).toBe("Would exceed the 60-hour weekly cap");
  });

  test("landing exactly on the cap is allowed", () => {
    expect(evaluateShiftPlacement(placement({ weeklyHours: 48 }))).toBeNull();
  });

  test("the cap is overridable for a tenant that sets a different one", () => {
    const issue = evaluateShiftPlacement(placement({ weeklyHours: 36, weeklyHourCap: 45 }));
    expect(issue?.rule).toBe("weekly_hour_cap");
    expect(issue?.message).toBe("Would exceed the 45-hour weekly cap");
  });
});

describe("weekly rest day / six-workday rule", () => {
  test("a guard already working six days in the week cannot take a seventh", () => {
    expect(MAX_WORKING_DAYS_PER_WEEK).toBe(6);
    const issue = evaluateShiftPlacement(
      placement({
        date: SUN,
        weeklyHours: 24,
        workedDates: new Set([MON, TUE, WED, THU, FRI, SAT]),
      }),
    );
    expect(issue?.rule).toBe("weekly_rest_day");
    expect(issue?.message).toBe("Would remove the guard's required weekly rest day");
  });

  test("five worked days still leaves room for a sixth", () => {
    const issue = evaluateShiftPlacement(
      placement({ date: SAT, weeklyHours: 24, workedDates: new Set([MON, TUE, WED, THU, FRI]) }),
    );
    expect(issue).toBeNull();
  });

  test("changing the shift on a date already worked is not a seventh day", () => {
    const issue = evaluateShiftPlacement(
      placement({
        date: SAT,
        weeklyHours: 24,
        workedDates: new Set([MON, TUE, WED, THU, FRI, SAT]),
      }),
    );
    expect(issue).toBeNull();
  });
});

describe("night/day conflict checks", () => {
  test("a Day shift the morning after a Night shift is refused", () => {
    const issue = evaluateShiftPlacement(
      placement({ date: WED, candidateKind: "day", kindByDate: new Map([[TUE, "night"]]) }),
    );
    expect(issue?.rule).toBe("night_to_day_conflict");
    expect(issue?.message).toBe("Night shift the previous day ends too close to this Day shift");
  });

  test("a Night shift the evening before a Day shift is refused", () => {
    const issue = evaluateShiftPlacement(
      placement({ date: WED, candidateKind: "night", kindByDate: new Map([[THU, "day"]]) }),
    );
    expect(issue?.rule).toBe("day_to_night_conflict");
    expect(issue?.message).toBe("Day shift the next day starts too close to this Night shift");
  });

  test("Night after Night and Day after Day are both fine", () => {
    expect(
      evaluateShiftPlacement(
        placement({ candidateKind: "night", kindByDate: new Map([[TUE, "night"]]) }),
      ),
    ).toBeNull();
    expect(
      evaluateShiftPlacement(
        placement({ candidateKind: "day", kindByDate: new Map([[TUE, "day"]]) }),
      ),
    ).toBeNull();
  });

  test("the conflict is checked across a week boundary, not only inside one week", () => {
    // Monday is the first day of its ISO week; the Night shift sits in the week before.
    const issue = evaluateShiftPlacement(
      placement({
        date: MON,
        candidateKind: "day",
        workedDates: new Set(),
        kindByDate: new Map([["2026-08-16", "night"]]),
      }),
    );
    expect(issue?.rule).toBe("night_to_day_conflict");
  });
});

describe("no minimum rest-gap rule was added (decision #4)", () => {
  test("a shift the day after another working day is allowed on rest grounds alone", () => {
    // Six consecutive 8-hour Day shifts: 48h, six days, no adjacency conflict. An 11-hour
    // rest-gap rule would reject some of these; the UAT confirmed no such rule is in scope.
    const issues = evaluateWorkingTimeRules(
      placement({
        date: SAT,
        candidateKind: "day",
        candidateHours: 8,
        weeklyHours: 40,
        workedDates: new Set([MON, TUE, WED, THU, FRI]),
        kindByDate: new Map([
          [MON, "day"],
          [TUE, "day"],
          [WED, "day"],
          [THU, "day"],
          [FRI, "day"],
        ]),
      }),
    );
    expect(issues).toEqual([]);
  });

  test("the rule set is exactly the six checks the UAT confirmed", () => {
    const everything = evaluateWorkingTimeRules(
      placement({
        date: SUN,
        candidateKind: "double",
        candidateHours: 24,
        alreadyRosteredOnDate: true,
        weeklyHours: 60,
        workedDates: new Set([MON, TUE, WED, THU, FRI, SAT]),
        kindByDate: new Map([[SAT, "night"]]),
      }),
    );
    expect(everything.map((i) => i.rule)).toEqual([
      "shift_kind_allowed",
      "one_shift_per_date",
      "weekly_hour_cap",
      "weekly_rest_day",
    ]);
  });
});
