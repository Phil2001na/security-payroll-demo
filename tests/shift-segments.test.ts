// Regression suite for the internal payroll segmentation (UAT decisions #1, #2, #8).
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  DEFAULT_SUNDAY_BOUNDARY_MODE,
  SUNDAY_BOUNDARY_MODES,
  segmentShift,
  sundayBoundaryModeCode,
  sundayBoundaryModeFromCode,
  type ShiftSegmentation,
} from "../src/lib/shift-segments.ts";

// 2026-08-22 is a Saturday, 2026-08-23 a Sunday, 2026-08-24 a Monday.
const SATURDAY = "2026-08-22";
const SUNDAY = "2026-08-23";
const MONDAY = "2026-08-24";
const WEDNESDAY = "2026-08-19";

const windows = (result: ShiftSegmentation) =>
  result.segments.map((s) => `${s.date} ${s.startClock}-${s.endClock} ${s.appliedRule}`);

// Every segmentation must satisfy these, whatever the shift or the mode. Called from each
// test rather than once at the end, so a failure names the case that broke it.
function assertIntegrity(result: ShiftSegmentation, expectedMinutes: number) {
  const total = result.segments.reduce((sum, s) => sum + s.minutes, 0);
  // No minute lost, none counted twice.
  expect(total).toBe(expectedMinutes);
  expect(result.totals.minutes).toBe(expectedMinutes);
  // Every minute lands in exactly one applied rule.
  expect(
    result.totals.ordinaryMinutes +
      result.totals.sundayMinutes +
      result.totals.publicHolidayMinutes,
  ).toBe(expectedMinutes);
  // Segments are contiguous in clock order and never overlap.
  for (let i = 1; i < result.segments.length; i += 1) {
    const previous = result.segments[i - 1];
    const current = result.segments[i];
    expect(previous.endMin).toBe(1440);
    expect(current.startMin).toBe(0);
    expect(current.dayOffset).toBe(previous.dayOffset + 1);
  }
  for (const segment of result.segments) {
    expect(segment.endMin).toBeGreaterThan(segment.startMin);
    expect(segment.minutes).toBe(segment.endMin - segment.startMin);
  }
}

describe("same-day shift", () => {
  test("a weekday day shift stays one segment under its own calendar rule", () => {
    const result = segmentShift({
      anchorDate: WEDNESDAY,
      startMin: 7 * 60,
      durationMinutes: 12 * 60,
    });
    expect(result.segments).toHaveLength(1);
    expect(result.crossesMidnight).toBe(false);
    expect(windows(result)).toEqual([`${WEDNESDAY} 07:00-19:00 ordinary`]);
    expect(result.startsAt).toBe(`${WEDNESDAY}T07:00`);
    expect(result.endsAt).toBe(`${WEDNESDAY}T19:00`);
    assertIntegrity(result, 720);
  });

  test("a same-day Sunday shift is Sunday throughout", () => {
    const result = segmentShift({ anchorDate: SUNDAY, startMin: 6 * 60, durationMinutes: 12 * 60 });
    expect(result.segments).toHaveLength(1);
    expect(result.totals.sundayMinutes).toBe(720);
    assertIntegrity(result, 720);
  });
});

describe("Saturday-to-Sunday shift — the client's worked example", () => {
  const result = segmentShift({
    anchorDate: SATURDAY,
    startMin: 18 * 60,
    durationMinutes: 12 * 60,
  });

  test("splits into Sat 18:00-24:00 ordinary + Sun 00:00-06:00 Sunday", () => {
    expect(windows(result)).toEqual([
      `${SATURDAY} 18:00-24:00 ordinary`,
      `${SUNDAY} 00:00-06:00 sunday`,
    ]);
    expect(result.totals.ordinaryMinutes).toBe(360);
    expect(result.totals.sundayMinutes).toBe(360);
  });

  test("reports the stored shift's real start and end", () => {
    expect(result.startsAt).toBe(`${SATURDAY}T18:00`);
    expect(result.endsAt).toBe(`${SUNDAY}T06:00`);
    expect(result.crossesMidnight).toBe(true);
    expect(result.midnightCrossings).toBe(1);
  });

  test("carries the s.19 night band across the split", () => {
    // 20:00-24:00 on the Saturday side, 00:00-06:00 on the Sunday side.
    expect(result.segments[0].nightMinutes).toBe(240);
    expect(result.segments[1].nightMinutes).toBe(360);
    expect(result.totals.nightMinutes).toBe(600);
  });

  test("segment total equals the stored shift duration", () => {
    assertIntegrity(result, 720);
  });
});

describe("Sunday-to-Monday shift", () => {
  const result = segmentShift({ anchorDate: SUNDAY, startMin: 18 * 60, durationMinutes: 12 * 60 });

  test("pays the Sunday portion as Sunday and the Monday portion as ordinary", () => {
    expect(windows(result)).toEqual([
      `${SUNDAY} 18:00-24:00 sunday`,
      `${MONDAY} 00:00-06:00 ordinary`,
    ]);
    expect(result.totals.sundayMinutes).toBe(360);
    expect(result.totals.ordinaryMinutes).toBe(360);
    assertIntegrity(result, 720);
  });
});

describe("shift crossing multiple midnights", () => {
  const result = segmentShift({
    anchorDate: SATURDAY,
    startMin: 18 * 60,
    durationMinutes: 40 * 60,
  });

  test("produces one segment per calendar day touched", () => {
    expect(result.segments.map((s) => s.date)).toEqual([SATURDAY, SUNDAY, MONDAY]);
    expect(result.midnightCrossings).toBe(2);
    expect(windows(result)).toEqual([
      `${SATURDAY} 18:00-24:00 ordinary`,
      `${SUNDAY} 00:00-24:00 sunday`,
      `${MONDAY} 00:00-10:00 ordinary`,
    ]);
  });

  test("still balances to the stored duration", () => {
    assertIntegrity(result, 2400);
    expect(result.totals.sundayMinutes).toBe(1440);
    expect(result.totals.ordinaryMinutes).toBe(960);
  });
});

describe("exact midnight boundaries", () => {
  test("a shift ending exactly at midnight does not spill into the next day", () => {
    const result = segmentShift({
      anchorDate: SATURDAY,
      startMin: 18 * 60,
      durationMinutes: 6 * 60,
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].endClock).toBe("24:00");
    expect(result.endDate).toBe(SATURDAY);
    expect(result.crossesMidnight).toBe(false);
    expect(result.totals.sundayMinutes).toBe(0);
    assertIntegrity(result, 360);
  });

  test("a shift starting exactly at midnight belongs wholly to the new day", () => {
    const result = segmentShift({ anchorDate: SUNDAY, startMin: 0, durationMinutes: 6 * 60 });
    expect(result.segments).toHaveLength(1);
    expect(windows(result)).toEqual([`${SUNDAY} 00:00-06:00 sunday`]);
    assertIntegrity(result, 360);
  });

  test("the boundary minute is claimed by exactly one side", () => {
    const result = segmentShift({
      anchorDate: SATURDAY,
      startMin: 23 * 60 + 59,
      durationMinutes: 2,
    });
    expect(windows(result)).toEqual([
      `${SATURDAY} 23:59-24:00 ordinary`,
      `${SUNDAY} 00:00-00:01 sunday`,
    ]);
    expect(result.totals.ordinaryMinutes).toBe(1);
    expect(result.totals.sundayMinutes).toBe(1);
    assertIntegrity(result, 2);
  });

  test("a full 24-hour shift from midnight is one day, not two", () => {
    const result = segmentShift({ anchorDate: SUNDAY, startMin: 0, durationMinutes: 24 * 60 });
    expect(result.segments).toHaveLength(1);
    expect(result.totals.sundayMinutes).toBe(1440);
    assertIntegrity(result, 1440);
  });
});

describe("invalid and zero-duration shifts", () => {
  test("a zero-hour shift yields no segments and no warning", () => {
    const result = segmentShift({ anchorDate: SATURDAY, startMin: 420, durationMinutes: 0 });
    expect(result.segments).toEqual([]);
    expect(result.totals.minutes).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  test("a negative duration is reported and treated as zero, never thrown", () => {
    const result = segmentShift({ anchorDate: SATURDAY, startMin: 420, durationMinutes: -120 });
    expect(result.segments).toEqual([]);
    expect(result.totals.minutes).toBe(0);
    expect(result.warnings.join(" ")).toContain("negative duration");
  });

  test("a non-numeric duration degrades to zero rather than producing NaN hours", () => {
    const result = segmentShift({
      anchorDate: SATURDAY,
      startMin: 420,
      durationMinutes: Number.NaN,
    });
    expect(result.segments).toEqual([]);
    expect(result.totals.minutes).toBe(0);
  });

  test("a fractional-hour shift still balances exactly", () => {
    const result = segmentShift({
      anchorDate: SATURDAY,
      startMin: 18 * 60,
      durationMinutes: 7.75 * 60,
    });
    assertIntegrity(result, 465);
    expect(result.segments[result.segments.length - 1].endClock).toBe("01:45");
  });
});

describe("configurable Sunday boundary modes (decision #1)", () => {
  const shift = { anchorDate: SATURDAY, startMin: 18 * 60, durationMinutes: 12 * 60 } as const;

  test("midnight_split is the default and is what the codes resolve to when unset", () => {
    expect(DEFAULT_SUNDAY_BOUNDARY_MODE).toBe("midnight_split");
    expect(sundayBoundaryModeFromCode(undefined)).toBe("midnight_split");
    expect(sundayBoundaryModeFromCode(null)).toBe("midnight_split");
    expect(sundayBoundaryModeFromCode(99)).toBe("midnight_split");
    expect(sundayBoundaryModeFromCode("nonsense")).toBe("midnight_split");
    for (const mode of SUNDAY_BOUNDARY_MODES) {
      expect(sundayBoundaryModeFromCode(sundayBoundaryModeCode(mode))).toBe(mode);
    }
  });

  test("midnight_split pays each side under its own day", () => {
    const result = segmentShift({ ...shift, boundaryMode: "midnight_split" });
    expect(result.totals.ordinaryMinutes).toBe(360);
    expect(result.totals.sundayMinutes).toBe(360);
    assertIntegrity(result, 720);
  });

  test("shift_start_day pays the whole shift as the day it began on", () => {
    const result = segmentShift({ ...shift, boundaryMode: "shift_start_day" });
    expect(result.totals.ordinaryMinutes).toBe(720);
    expect(result.totals.sundayMinutes).toBe(0);
    // The segments are still shown, and say why the Sunday half was paid as ordinary.
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1].calendarRule).toBe("sunday");
    expect(result.segments[1].appliedRule).toBe("ordinary");
    expect(result.segments[1].ruleReason).toContain("shift_start_day");
    assertIntegrity(result, 720);
  });

  test("majority_of_shift gives the whole shift to the day holding most of its hours", () => {
    // Saturday 22:00 → Sunday 06:00: 2h Saturday against 6h Sunday.
    const result = segmentShift({
      anchorDate: SATURDAY,
      startMin: 22 * 60,
      durationMinutes: 8 * 60,
      boundaryMode: "majority_of_shift",
    });
    expect(result.totals.sundayMinutes).toBe(480);
    expect(result.totals.ordinaryMinutes).toBe(0);
    expect(result.segments[0].appliedRule).toBe("sunday");
    expect(result.segments[0].ruleReason).toContain("majority_of_shift");
    assertIntegrity(result, 480);
  });

  test("majority_of_shift keeps a mostly-Saturday shift on the ordinary rule", () => {
    const result = segmentShift({
      anchorDate: SATURDAY,
      // 16:00-24:00 is 8h Saturday against 2h Sunday.
      startMin: 16 * 60,
      durationMinutes: 10 * 60,
      boundaryMode: "majority_of_shift",
    });
    expect(result.totals.ordinaryMinutes).toBe(600);
    expect(result.totals.sundayMinutes).toBe(0);
    assertIntegrity(result, 600);
  });

  test("majority_of_shift resolves the 6/6 tie itself, with no separate tie-breaker", () => {
    const result = segmentShift({ ...shift, boundaryMode: "majority_of_shift" });
    // The UAT's 18:00-06:00 example is an exact tie; it resolves to the higher-rate day.
    expect(result.totals.sundayMinutes).toBe(720);
    expect(result.totals.ordinaryMinutes).toBe(0);
    expect(result.warnings.join(" ")).toContain("splits evenly");
    assertIntegrity(result, 720);
  });

  test("every mode balances on the same shift", () => {
    for (const mode of SUNDAY_BOUNDARY_MODES) {
      assertIntegrity(segmentShift({ ...shift, boundaryMode: mode }), 720);
    }
  });
});

describe("public holidays", () => {
  test("a public holiday outranks the calendar day rule per segment", () => {
    const result = segmentShift({
      anchorDate: SATURDAY,
      startMin: 18 * 60,
      durationMinutes: 12 * 60,
      publicHolidayDates: new Set([SUNDAY]),
    });
    expect(result.totals.publicHolidayMinutes).toBe(360);
    expect(result.totals.ordinaryMinutes).toBe(360);
    expect(result.totals.sundayMinutes).toBe(0);
    assertIntegrity(result, 720);
  });

  test("a forced shift-type rule overrides the calendar and records why", () => {
    const result = segmentShift({
      anchorDate: SATURDAY,
      startMin: 18 * 60,
      durationMinutes: 12 * 60,
      forcedRule: "sunday",
      forcedRuleReason: 'Shift type pay rule "sunday_default" fixes the whole shift',
    });
    expect(result.totals.sundayMinutes).toBe(720);
    expect(result.segments[0].calendarRule).toBe("ordinary");
    expect(result.segments[0].appliedRule).toBe("sunday");
    expect(result.segments[0].ruleReason).toContain("sunday_default");
    assertIntegrity(result, 720);
  });
});

describe("timezone behaviour", () => {
  // The whole calculation is wall-clock date arithmetic, so the host timezone must not
  // change a single field. Run out-of-process because TZ is read at runtime start-up.
  const probe = join(import.meta.dir, "tz-probe.ts");
  const run = (tz: string) =>
    execFileSync(process.execPath, [probe], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    });

  test("segmentation is identical in UTC, Windhoek and either extreme", () => {
    const utc = run("UTC");
    // Africa/Windhoek is the app's operating timezone (UTC+2, no DST since 2017).
    expect(run("Africa/Windhoek")).toBe(utc);
    // Furthest either side of UTC, where a naive local-time implementation would slip a day.
    expect(run("Pacific/Kiritimati")).toBe(utc); // UTC+14
    expect(run("Pacific/Midway")).toBe(utc); // UTC-11
  });

  test("the probe really is the client's Saturday-to-Sunday example", () => {
    const parsed = JSON.parse(run("UTC"));
    expect(parsed.startsAt).toBe(`${SATURDAY}T18:00`);
    expect(parsed.endsAt).toBe(`${SUNDAY}T06:00`);
    expect(parsed.segments.map((s: { appliedRule: string }) => s.appliedRule)).toEqual([
      "ordinary",
      "sunday",
    ]);
  });
});

describe("the stored shift is never mutated", () => {
  test("segmentShift does not touch the arguments it was given", () => {
    const holidays = new Set([MONDAY]);
    const args = {
      anchorDate: SATURDAY,
      startMin: 18 * 60,
      durationMinutes: 12 * 60,
      publicHolidayDates: holidays,
    };
    const snapshot = JSON.stringify({ ...args, publicHolidayDates: [...holidays] });
    segmentShift(args);
    expect(JSON.stringify({ ...args, publicHolidayDates: [...holidays] })).toBe(snapshot);
    expect(holidays.size).toBe(1);
  });
});
