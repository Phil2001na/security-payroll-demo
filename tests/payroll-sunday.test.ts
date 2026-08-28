// End-to-end payroll regression for the Sunday decisions (#1, #2, #5, #7, #8).
import { describe, expect, test } from "bun:test";
import {
  calculateNetPay,
  type EmployeeRow,
  type PayrollConstants,
  type ShiftLogRow,
} from "../src/lib/payroll-engine.ts";

const SATURDAY = "2026-08-22";
const SUNDAY = "2026-08-23";
const MONDAY = "2026-08-24";

// Deductions and tax are zeroed so the assertions read as pure hours × rate.
const constants: PayrollConstants = {
  ssc_rate: 0,
  ssc_max_deduction: 0,
  tax_free_threshold: 100_000,
  min_wage_security: 16,
  vet_threshold: 83_333,
  vet_rate: 0.01,
  night_premium_rate: 0.06,
  overtime_multiplier: 1.5,
  sunday_multiplier: 2,
  sunday_agreed_multiplier: 1.5,
  public_holiday_multiplier: 2,
  weekly_ordinary_cap: 60,
  periods_per_year: 12,
};

const RATE = 20;

function employee(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    id: "employee-1",
    employee_code: "G-001",
    surname: "Nangolo",
    first_names: "Petrus",
    display_name: null,
    hourly_rate: RATE,
    category: "officer",
    transport_allowance: 0,
    ordinarily_works_sundays: true,
    // Standing consent in a signed employment contract — the basis the client confirmed.
    contract_signed_at: "2026-01-15T09:00:00Z",
    sunday_agreement_url: null,
    bank_name: null,
    bank_account_number: null,
    ...overrides,
  };
}

// One stored shift: anchor date, clock window on the shift type, worked hours. This is
// exactly the shape shift_logs has — nothing here models a pre-split pair of shifts.
function shift(
  id: string,
  date: string,
  hours: number,
  startMin: number,
  overrides: Partial<ShiftLogRow> = {},
): ShiftLogRow {
  return {
    id,
    employee_id: "employee-1",
    date,
    hours_worked: hours,
    night_hours: 0,
    status: "approved",
    schedule_assignments: { is_replacement: false, planned_hours: hours },
    shift_types: {
      code: "NIGHT",
      is_leave: false,
      pay_rule: "standard",
      rate_multiplier: 1,
      start_min: startMin,
      end_min: (startMin + hours * 60) % 1440,
      period: startMin >= 19 * 60 || startMin < 7 * 60 ? "night" : "day",
    },
    ...overrides,
  };
}

function run(args: {
  logs: ShiftLogRow[];
  employee?: EmployeeRow;
  sundayBoundaryMode?: "midnight_split" | "majority_of_shift" | "shift_start_day";
  sundayBaseRate?: number | null;
  publicHolidayDates?: Set<string>;
}) {
  return calculateNetPay({
    employee: args.employee ?? employee(),
    logs: args.logs,
    disciplinary: [],
    publicHolidayDates: args.publicHolidayDates,
    sundayBoundaryMode: args.sundayBoundaryMode,
    sundayBaseRate: args.sundayBaseRate,
    // Night premium off so the Sunday arithmetic is not clouded by the +6% band.
    nightPremiumEnabled: false,
    constants,
    brackets: [],
  });
}

// The UAT's worked example: Saturday 18:00 → Sunday 06:00 as ONE stored shift.
const saturdayIntoSunday = [shift("shift-1", SATURDAY, 12, 18 * 60)];

describe("Saturday-to-Sunday shift is paid segment by segment (decisions #1, #2)", () => {
  const result = run({ logs: saturdayIntoSunday });

  test("six ordinary hours and six Sunday hours", () => {
    expect(result.normal_hours).toBe(6);
    expect(result.sunday_hours).toBe(6);
    expect(result.overtime_hours).toBe(0);
  });

  test("pays 6 x rate + 6 x 1.5 x rate, the client's stated expression", () => {
    expect(result.normal_amount).toBe(6 * RATE);
    expect(result.sunday_amount).toBe(6 * 1.5 * RATE);
    // 15 base-rate hours of pay.
    expect(result.gross_salary).toBe(15 * RATE);
  });

  test("the breakdown exposes the internal segments", () => {
    const segments = result.breakdown.segments;
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => `${s.segment_date} ${s.segment_start}-${s.segment_end}`)).toEqual([
      `${SATURDAY} 18:00-24:00`,
      `${SUNDAY} 00:00-06:00`,
    ]);
    expect(segments.map((s) => s.pay_category)).toEqual(["ordinary", "sunday"]);
    // Both segments name the one stored shift they came from.
    expect(new Set(segments.map((s) => s.shift_log_id))).toEqual(new Set(["shift-1"]));
    expect(segments[0].shift_starts_at).toBe(`${SATURDAY}T18:00`);
    expect(segments[0].shift_ends_at).toBe(`${SUNDAY}T06:00`);
    expect(segments[0].crosses_midnight).toBe(true);
  });

  test("no minute is lost or double-counted", () => {
    expect(result.breakdown.segment_integrity.balanced).toBe(true);
    expect(result.breakdown.segment_integrity.stored_minutes).toBe(720);
    expect(result.breakdown.segment_integrity.segment_minutes).toBe(720);
    const segmentHours = result.breakdown.segments.reduce((sum, s) => sum + s.hours, 0);
    expect(segmentHours).toBe(12);
    expect(result.normal_hours + result.sunday_hours).toBe(12);
  });
});

describe("Sunday-to-Monday shift", () => {
  const result = run({ logs: [shift("shift-2", SUNDAY, 12, 18 * 60)] });

  test("the Sunday portion takes the Sunday rate and the Monday portion is ordinary", () => {
    expect(result.sunday_hours).toBe(6);
    expect(result.normal_hours).toBe(6);
    expect(result.sunday_amount).toBe(6 * 1.5 * RATE);
    expect(result.normal_amount).toBe(6 * RATE);
    expect(result.breakdown.segments.map((s) => s.segment_date)).toEqual([SUNDAY, MONDAY]);
  });
});

describe("same-day and multi-midnight shifts", () => {
  test("a plain weekday shift is one segment of ordinary hours", () => {
    const result = run({ logs: [shift("shift-3", "2026-08-19", 12, 7 * 60)] });
    expect(result.normal_hours).toBe(12);
    expect(result.sunday_hours).toBe(0);
    expect(result.breakdown.segments).toHaveLength(1);
  });

  test("a 40-hour shift crossing two midnights splits three ways and still balances", () => {
    const result = run({ logs: [shift("shift-4", SATURDAY, 40, 18 * 60)] });
    expect(result.breakdown.segments).toHaveLength(3);
    expect(result.sunday_hours).toBe(24);
    // 6h Saturday + 10h Monday = 16 ordinary hours, all inside the 60h weekly cap.
    expect(result.normal_hours).toBe(16);
    expect(result.overtime_hours).toBe(0);
    expect(result.breakdown.segment_integrity.balanced).toBe(true);
  });
});

describe("configurable Sunday boundary mode drives the money (decision #1)", () => {
  test("midnight_split — the default — splits the pay at midnight", () => {
    const result = run({ logs: saturdayIntoSunday, sundayBoundaryMode: "midnight_split" });
    expect(result.gross_salary).toBe(15 * RATE);
    expect(result.breakdown.boundary_mode).toBe("midnight_split");
  });

  test("shift_start_day pays the whole shift as Saturday ordinary work", () => {
    const result = run({ logs: saturdayIntoSunday, sundayBoundaryMode: "shift_start_day" });
    expect(result.normal_hours).toBe(12);
    expect(result.sunday_hours).toBe(0);
    expect(result.gross_salary).toBe(12 * RATE);
    expect(result.breakdown.segments[1].calendar_rule).toBe("sunday");
    expect(result.breakdown.segments[1].applied_rule).toBe("ordinary");
    expect(result.breakdown.segments[1].rule_reason).toContain("shift_start_day");
  });

  test("majority_of_shift pays the whole tied shift as Sunday", () => {
    const result = run({ logs: saturdayIntoSunday, sundayBoundaryMode: "majority_of_shift" });
    expect(result.sunday_hours).toBe(12);
    expect(result.normal_hours).toBe(0);
    expect(result.gross_salary).toBe(12 * 1.5 * RATE);
    expect(result.warnings.join(" ")).toContain("splits evenly");
  });

  test("no mode loses or duplicates an hour", () => {
    for (const mode of ["midnight_split", "majority_of_shift", "shift_start_day"] as const) {
      const result = run({ logs: saturdayIntoSunday, sundayBoundaryMode: mode });
      expect(result.normal_hours + result.sunday_hours + result.public_holiday_hours).toBe(12);
      expect(result.breakdown.segment_integrity.balanced).toBe(true);
    }
  });
});

describe("Sunday consent controls the multiplier (decision #7)", () => {
  test("standing contract consent earns the agreed 1.5x", () => {
    const result = run({ logs: saturdayIntoSunday });
    expect(result.sunday_basis).toBe("contract_agreed_1_5x");
    expect(result.sunday_consent_verified).toBe(true);
    expect(result.sunday_multiplier_applied).toBe(1.5);
    expect(result.breakdown.sunday_consent_evidence).toBe("signed_employment_contract");
  });

  test("a separate signed Sunday agreement is basis enough on its own", () => {
    const result = run({
      logs: saturdayIntoSunday,
      employee: employee({
        ordinarily_works_sundays: false,
        contract_signed_at: null,
        sunday_agreement_url: "https://storage/agreements/g-001-sunday.pdf",
      }),
    });
    expect(result.sunday_basis).toBe("contract_agreed_1_5x");
    expect(result.breakdown.sunday_consent_evidence).toBe("sunday_agreement");
    expect(result.sunday_amount).toBe(6 * 1.5 * RATE);
  });

  test("an unsigned contract falls back from 1.5x to the statutory 2x", () => {
    const result = run({
      logs: saturdayIntoSunday,
      employee: employee({ contract_signed_at: null }),
    });
    expect(result.sunday_basis).toBe("statutory_default_2x");
    expect(result.sunday_consent_verified).toBe(false);
    expect(result.sunday_multiplier_applied).toBe(2);
    expect(result.sunday_amount).toBe(6 * 2 * RATE);
    // Payroll still runs — the fallback is not a block.
    expect(result.gross_salary).toBe(6 * RATE + 6 * 2 * RATE);
  });

  test("an employee not recorded as ordinarily working Sundays falls back too", () => {
    const result = run({
      logs: saturdayIntoSunday,
      employee: employee({ ordinarily_works_sundays: false }),
    });
    expect(result.sunday_basis).toBe("statutory_default_2x");
    expect(result.sunday_amount).toBe(6 * 2 * RATE);
  });

  test("the fallback reason reaches the warnings and the breakdown", () => {
    const result = run({
      logs: saturdayIntoSunday,
      employee: employee({ ordinarily_works_sundays: false, contract_signed_at: null }),
    });
    const warning = result.warnings.find((w) => w.includes("Sunday consent"));
    expect(warning).toBeDefined();
    expect(warning).toContain("statutory 2× default");
    expect(result.breakdown.sunday_consent_reasons).toEqual([
      "Employee is not recorded as ordinarily working Sundays",
      "No signed employment contract on file to carry the standing Sunday consent",
    ]);
  });

  test("no Sunday hours means no consent warning is raised", () => {
    const result = run({
      logs: [shift("shift-5", "2026-08-19", 12, 7 * 60)],
      employee: employee({ ordinarily_works_sundays: false, contract_signed_at: null }),
    });
    expect(result.warnings.filter((w) => w.includes("Sunday consent"))).toEqual([]);
  });

  test("a call-in Sunday stays at the 2x default whatever the consent says", () => {
    const result = run({
      logs: [
        shift("shift-6", SATURDAY, 12, 18 * 60, {
          schedule_assignments: { is_replacement: true, planned_hours: 12 },
        }),
      ],
    });
    expect(result.sunday_callin_hours).toBe(6);
    expect(result.sunday_hours).toBe(0);
    expect(result.sunday_callin_amount).toBe(6 * 2 * RATE);
    expect(result.breakdown.segments[1].pay_category).toBe("sunday_callin");
  });
});

describe("manually entered Sunday base rate (decision #5)", () => {
  test("no manual entry keeps the employee's ordinary rate as the Sunday base", () => {
    const result = run({ logs: saturdayIntoSunday });
    expect(result.sunday_base_rate).toBe(RATE);
    expect(result.sunday_base_rate_source).toBe("employee_ordinary_rate");
    expect(result.warnings.filter((w) => w.includes("manually entered"))).toEqual([]);
  });

  test("a manual rate equal to the ordinary rate changes nothing and warns about nothing", () => {
    const result = run({ logs: saturdayIntoSunday, sundayBaseRate: RATE });
    expect(result.sunday_base_rate).toBe(RATE);
    expect(result.sunday_base_rate_source).toBe("manual_period_entry");
    expect(result.sunday_amount).toBe(6 * 1.5 * RATE);
    expect(result.warnings.filter((w) => w.includes("manually entered"))).toEqual([]);
  });

  test("a manual rate above the ordinary rate is used and flagged", () => {
    const result = run({ logs: saturdayIntoSunday, sundayBaseRate: 25 });
    expect(result.sunday_base_rate).toBe(25);
    expect(result.sunday_amount).toBe(6 * 1.5 * 25);
    // Ordinary hours stay on the employee's own rate.
    expect(result.normal_amount).toBe(6 * RATE);
    const warning = result.warnings.find((w) => w.includes("manually entered base rate"));
    expect(warning).toBeDefined();
    expect(warning).toContain("N$25.00");
    expect(warning).toContain("N$20.00");
  });
});

describe("existing behaviour that must not move", () => {
  test("the 60-hour weekly cap still splits normal from overtime and warns", () => {
    // Six 12-hour weekday shifts in one ISO week = 72 ordinary hours.
    const week = [
      shift("w-1", "2026-08-17", 12, 7 * 60),
      shift("w-2", "2026-08-18", 12, 7 * 60),
      shift("w-3", "2026-08-19", 12, 7 * 60),
      shift("w-4", "2026-08-20", 12, 7 * 60),
      shift("w-5", "2026-08-21", 12, 7 * 60),
      shift("w-6", SATURDAY, 12, 7 * 60),
    ];
    const result = run({ logs: week });
    expect(result.normal_hours).toBe(60);
    expect(result.overtime_hours).toBe(12);
    expect(result.warnings.join(" ")).toContain("exceeds the 60h/week cap");
  });

  test("a public holiday still outranks the Sunday rule and pays 2x", () => {
    const result = run({
      logs: saturdayIntoSunday,
      publicHolidayDates: new Set([SUNDAY]),
    });
    expect(result.public_holiday_hours).toBe(6);
    expect(result.sunday_hours).toBe(0);
    expect(result.public_holiday_amount).toBe(6 * 2 * RATE);
  });

  test("an explicit Sunday shift type still fixes the whole shift, and says so", () => {
    const result = run({
      logs: [
        shift("shift-7", SATURDAY, 12, 18 * 60, {
          shift_types: {
            code: "SUN",
            is_leave: false,
            pay_rule: "sunday_default",
            rate_multiplier: 1.5,
            start_min: 18 * 60,
            end_min: 6 * 60,
            period: "night",
          },
        }),
      ],
    });
    expect(result.sunday_hours).toBe(12);
    expect(result.normal_hours).toBe(0);
    expect(result.breakdown.segments[0].applied_rule).toBe("sunday");
    expect(result.breakdown.segments[0].calendar_rule).toBe("ordinary");
    expect(result.breakdown.segments[0].rule_reason).toContain("sunday_default");
  });

  test("unapproved attendance is still unpaid", () => {
    const result = run({
      logs: [shift("shift-8", SATURDAY, 12, 18 * 60, { status: "submitted" })],
    });
    expect(result.gross_salary).toBe(0);
    expect(result.breakdown.segments).toEqual([]);
  });

  test("the night premium still measures the s.19 band across the midnight split", () => {
    const result = calculateNetPay({
      employee: employee(),
      logs: saturdayIntoSunday,
      disciplinary: [],
      nightPremiumEnabled: true,
      constants,
      brackets: [],
    });
    // 20:00-24:00 plus 00:00-06:00 = 10 hours in the band.
    expect(result.night_hours).toBe(10);
    expect(result.night_premium_amount).toBe(Math.round(10 * RATE * 0.06 * 100) / 100);
  });
});

describe("historical records are not rewritten (decision #8)", () => {
  test("calculating a period leaves the stored shift rows untouched", () => {
    const logs = [shift("shift-9", SATURDAY, 12, 18 * 60), shift("shift-10", SUNDAY, 12, 18 * 60)];
    const before = JSON.stringify(logs);
    const subject = employee();
    const employeeBefore = JSON.stringify(subject);

    run({ logs, employee: subject });
    run({ logs, employee: subject, sundayBoundaryMode: "majority_of_shift" });
    run({ logs, employee: subject, sundayBaseRate: 31.5 });

    expect(JSON.stringify(logs)).toBe(before);
    expect(JSON.stringify(subject)).toBe(employeeBefore);
  });

  test("one stored shift stays one stored shift, however many segments it pays as", () => {
    const logs = saturdayIntoSunday;
    const result = run({ logs });
    // Two internal segments...
    expect(result.breakdown.segments).toHaveLength(2);
    // ...from exactly one stored shift record, which is still the only row in the input.
    expect(logs).toHaveLength(1);
    expect(new Set(result.breakdown.segments.map((s) => s.shift_log_id)).size).toBe(1);
    expect(logs[0].hours_worked).toBe(12);
    expect(logs[0].date).toBe(SATURDAY);
  });

  test("recalculating the same inputs is deterministic", () => {
    const first = run({ logs: saturdayIntoSunday });
    const second = run({ logs: saturdayIntoSunday });
    expect(JSON.stringify(second.breakdown)).toBe(JSON.stringify(first.breakdown));
    expect(second.net_salary).toBe(first.net_salary);
  });
});
