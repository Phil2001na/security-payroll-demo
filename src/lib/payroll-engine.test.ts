import { describe, expect, it } from "vitest";
import {
  calcPAYE,
  calculateNetPay,
  round2,
  type EmployeeRow,
  type PayrollConstants,
  type ShiftLogRow,
} from "./payroll-engine";

const constants: PayrollConstants = {
  ssc_rate: 0.009,
  ssc_max_deduction: 99,
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
  sunday_boundary_rule: "midnight_split",
};

const employee: EmployeeRow = {
  id: "employee-1",
  employee_code: "E-001",
  surname: "Guard",
  first_names: "Test",
  display_name: null,
  hourly_rate: 20,
  transport_allowance: 0,
  ordinarily_works_sundays: true,
  bank_name: null,
  bank_account_number: null,
};

function log(overrides: Partial<ShiftLogRow> = {}): ShiftLogRow {
  return {
    id: "log-1",
    employee_id: employee.id,
    date: "2026-08-31",
    hours_worked: 8,
    night_hours: 0,
    status: "approved",
    shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 420, end_min: 900, period: "day" },
    ...overrides,
  };
}

function calc(logs: ShiftLogRow[]) {
  return calculateNetPay({ employee, logs, disciplinary: [], constants, brackets: [] });
}

describe("payroll engine characterisation", () => {
  it("pays a same-day standard shift as ordinary hours", () => {
    const result = calc([log()]);
    expect(result.normal_hours).toBe(8);
    expect(result.overtime_hours).toBe(0);
    expect(result.sunday_hours).toBe(0);
  });

  it("splits a Saturday-to-Sunday shift at midnight", () => {
    const result = calc([log({ date: "2026-08-29", hours_worked: 12, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 1080, end_min: 360, period: "night" } })]);
    expect(result.normal_hours).toBe(6);
    expect(result.sunday_hours).toBe(6);
    expect(result.night_hours).toBe(10);
  });

  it("splits a Sunday-to-Monday shift at midnight", () => {
    const result = calc([log({ date: "2026-08-30", hours_worked: 12, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 1080, end_min: 360, period: "night" } })]);
    expect(result.sunday_hours).toBe(6);
    expect(result.normal_hours).toBe(6);
  });

  it("can classify the whole shift by a configured calendar-day majority", () => {
    const result = calculateNetPay({
      employee,
      logs: [log({ date: "2026-08-29", hours_worked: 10, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 1200, end_min: 360, period: "night" } })],
      disciplinary: [],
      constants: { ...constants, sunday_boundary_rule: "majority_of_shift" },
      brackets: [],
    });
    expect(result.sunday_hours).toBe(10);
    expect(result.normal_hours).toBe(0);
    expect(result.calculation_segments.map((segment) => segment.classification)).toEqual(["sunday", "sunday"]);
  });

  it("refuses an unresolved majority-of-shift tie", () => {
    expect(() => calculateNetPay({
      employee,
      logs: [log({ date: "2026-08-29", hours_worked: 12, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 1080, end_min: 360, period: "night" } })],
      disciplinary: [],
      constants: { ...constants, sunday_boundary_rule: "majority_of_shift" },
      brackets: [],
    })).toThrow("client direction is required");
  });

  it("does not treat a tie between two ordinary days as a Sunday ambiguity", () => {
    const result = calculateNetPay({
      employee,
      // Mon 18:00 -> Tue 06:00: an exact 6/6 tie, but no Sunday for the rule to decide.
      logs: [log({ date: "2026-08-31", hours_worked: 12, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 1080, end_min: 360, period: "night" } })],
      disciplinary: [],
      constants: { ...constants, sunday_boundary_rule: "majority_of_shift" },
      brackets: [],
    });
    expect(result.sunday_hours).toBe(0);
    expect(result.normal_hours).toBe(12);
    expect(result.calculation_segments.map((segment) => segment.date)).toEqual(["2026-08-31", "2026-09-01"]);
  });

  it("keeps public-holiday hours on their real date under majority-of-shift", () => {
    const result = calculateNetPay({
      employee,
      // Sat 20:00 -> Sun 08:00. The Sunday side holds the majority, but the Saturday
      // is a declared public holiday and those 4h must stay public-holiday hours.
      logs: [log({ date: "2026-08-29", hours_worked: 12, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 1200, end_min: 480, period: "night" } })],
      disciplinary: [],
      constants: { ...constants, sunday_boundary_rule: "majority_of_shift" },
      brackets: [],
      publicHolidayDates: new Set(["2026-08-29"]),
    });
    expect(result.public_holiday_hours).toBe(4);
    expect(result.sunday_hours).toBe(8);
    expect(result.calculation_segments.map((segment) => segment.classification)).toEqual(["public_holiday", "sunday"]);
  });

  it("handles a shift crossing multiple midnights without losing hours", () => {
    const result = calc([log({ hours_worked: 49, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 0, end_min: 60, period: "day" } })]);
    expect(result.normal_hours + result.overtime_hours + result.sunday_hours).toBe(49);
  });

  it("treats an exact midnight end as belonging only to the prior day", () => {
    const result = calc([log({ date: "2026-08-29", hours_worked: 5, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 1140, end_min: 0, period: "night" } })]);
    expect(result.normal_hours).toBe(5);
    expect(result.sunday_hours).toBe(0);
    expect(result.night_hours).toBe(4);
  });

  it("does not create paid buckets for zero or negative durations", () => {
    for (const hours_worked of [0, -2]) {
      const result = calc([log({ hours_worked })]);
      expect(result.normal_hours + result.overtime_hours + result.sunday_hours + result.sunday_callin_hours).toBe(0);
    }
  });

  it("isolates the wrapped 20:00–07:00 night band", () => {
    const result = calc([log({ hours_worked: 13.5, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 1080, end_min: 450, period: "night" } })]);
    expect(result.night_hours).toBe(11);
    expect(result.normal_hours + result.sunday_hours).toBe(13.5);
  });

  it("splits weekly ordinary time against the cap", () => {
    const result = calc([log({ hours_worked: 65, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 420, end_min: 720, period: "day" } })]);
    expect(result.normal_hours).toBe(60);
    expect(result.overtime_hours).toBe(5);
    expect(result.warnings).toContain("Week of 2026-08-31: 65.0h exceeds the 60h/week cap without a PS exemption");
  });

  it("uses 1.5× for rostered Sunday and 2× for a call-in Sunday", () => {
    const sunday = log({ date: "2026-08-30", hours_worked: 8, shift_types: { pay_rule: "standard", rate_multiplier: 1, start_min: 420, end_min: 900, period: "day" } });
    expect(calc([sunday]).sunday_amount).toBe(240);
    expect(calc([{ ...sunday, schedule_assignments: { is_replacement: true } }]).sunday_callin_amount).toBe(320);
  });

  it("annualises PAYE before returning the period amount", () => {
    expect(calcPAYE(10_000, [{ lower_bound: 100_000, upper_bound: null, base_tax: 0, marginal_rate: 0.2 }], 12)).toBeCloseTo(333.3333333333);
  });

  it("rounds money so net always equals gross minus deductions", () => {
    const result = calculateNetPay({
      employee: { ...employee, hourly_rate: 17.33, transport_allowance: 11.11 },
      logs: [log({ hours_worked: 7.25 })],
      disciplinary: [],
      constants,
      brackets: [{ lower_bound: 0, upper_bound: null, base_tax: 0, marginal_rate: 0.1 }],
      consensualDeductions: 3.33,
    });
    expect(result.net_salary).toBe(round2(result.gross_salary - result.total_deductions));
  });
});
