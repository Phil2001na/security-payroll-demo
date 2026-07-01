// Demo Payroll System Engine — Gross-to-Net Calculator
// Implements Labour Act + Income Tax calculations using live payroll_constants.
import { supabase } from "@/integrations/supabase/client";

// Round to cents. All monetary components are rounded before summing so that
// stored gross/deductions/net are exact 2dp values and net === gross - deductions.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function estimateShiftCost(
  hourlyRate: number,
  shiftHours: number,
  currentWeeklyOrdinaryHours: number,
  payRule: string,
  isNightPeriod: boolean,
  constants: {
    weekly_ordinary_cap: number;
    overtime_multiplier: number;
    sunday_multiplier: number;
    sunday_agreed_multiplier?: number;
    public_holiday_multiplier: number;
    night_premium_rate: number;
  },
  // Employees who ordinarily work Sundays under agreement are costed at the reduced
  // Sunday multiplier, so the cheapest-guard ranking matches what they're actually paid.
  ordinarilyWorksSundays = false,
): number {
  const nightAdder = isNightPeriod ? shiftHours * hourlyRate * constants.night_premium_rate : 0;
  if (payRule === "sunday_default" || payRule === "sunday_ordinary") {
    const sundayMult = ordinarilyWorksSundays && constants.sunday_agreed_multiplier != null
      ? constants.sunday_agreed_multiplier
      : constants.sunday_multiplier;
    return round2(shiftHours * hourlyRate * sundayMult + nightAdder);
  }
  if (payRule.startsWith("public_holiday")) {
    return round2(shiftHours * hourlyRate * constants.public_holiday_multiplier + nightAdder);
  }
  const ordinaryRemaining = Math.max(0, constants.weekly_ordinary_cap - currentWeeklyOrdinaryHours);
  const ordinaryHours = Math.min(shiftHours, ordinaryRemaining);
  const overtimeHours = shiftHours - ordinaryHours;
  return round2(
    ordinaryHours * hourlyRate +
    overtimeHours * hourlyRate * constants.overtime_multiplier +
    nightAdder,
  );
}

export type ShiftLogRow = {
  id: string;
  employee_id: string;
  date: string;
  hours_worked: number;
  night_hours: number;
  status: "pending" | "submitted" | "approved" | "no_show" | "replaced_by_other" | "suspended_unpaid";
  shift_types?: {
    pay_rule: string;
    rate_multiplier: number;
    // Clock window of the shift, in minutes from midnight (07:00 = 420, 19:00 = 1140).
    // Lets the engine split a shift's hours across the midnight / Sunday / public-holiday
    // boundary and isolate the night band. Nullable for shift types created before windows
    // existed — we fall back to the period default.
    start_min?: number | null;
    end_min?: number | null;
    period?: string | null;
  } | null;
};

export type EmployeeRow = {
  id: string;
  employee_code: string;
  surname: string;
  first_names: string;
  display_name: string | null;
  hourly_rate: number;
  monthly_salary?: number | null;
  category?: "officer" | "management" | null;
  transport_allowance: number;
  ordinarily_works_sundays: boolean;
  bank_name: string | null;
  bank_account_number: string | null;
};

export type DisciplinaryRow = {
  id: string;
  employee_id: string;
  action_type: string;
  fine_amount: number | null;
  suspension_hours: number | null;
  collective_agreement_reference: string | null;
  offence_code: string;
};

export type PayrollConstants = {
  ssc_rate: number;
  ssc_max_deduction: number;
  tax_free_threshold: number;
  min_wage_security: number;
  vet_threshold: number;
  vet_rate: number;
  night_premium_rate: number;
  overtime_multiplier: number;
  sunday_multiplier: number;
  // Reduced Sunday multiplier for employees who ordinarily work Sundays under a written
  // agreement (Labour Act s.21 — 1.5× instead of the 2× default).
  sunday_agreed_multiplier: number;
  public_holiday_multiplier: number;
  weekly_ordinary_cap: number;
  periods_per_year: number;
};

export type PayeBracket = {
  lower_bound: number;
  upper_bound: number | null;
  base_tax: number;
  marginal_rate: number;
};

export type PayslipBuckets = {
  normal_hours: number;
  overtime_hours: number;
  sunday_hours: number;
  public_holiday_hours: number;
  night_hours: number;
  suspended_hours: number;
};

export type PayslipCalc = PayslipBuckets & {
  employee: EmployeeRow;
  rate: number;
  normal_amount: number;
  overtime_amount: number;
  sunday_amount: number;
  public_holiday_amount: number;
  night_premium_amount: number;
  transport_allowance: number;
  gross_salary: number;
  paye_amount: number;
  ssc_amount: number;
  fine_deductions: number;
  disqualified_fines: number; // fines without CA ref — set to 0 but surfaced
  consensual_deductions: number;
  total_deductions: number;
  net_salary: number;
  warnings: string[];
};

// ---------- Constants fetch ----------

export async function fetchPayrollConstants(): Promise<{ constants: PayrollConstants; brackets: PayeBracket[] }> {
  const [{ data: constRows, error: cErr }, { data: bracketRows, error: bErr }] = await Promise.all([
    supabase.from("payroll_constants").select("key,value"),
    supabase.from("paye_brackets").select("lower_bound,upper_bound,base_tax,marginal_rate").order("lower_bound"),
  ]);
  if (cErr) throw cErr;
  if (bErr) throw bErr;

  const map = new Map<string, number>();
  (constRows ?? []).forEach((r) => map.set(r.key, Number(r.value)));

  const constants: PayrollConstants = {
    ssc_rate: map.get("ssc_employee_rate") ?? map.get("ssc_rate") ?? 0.009,
    ssc_max_deduction: map.get("ssc_max_deduction") ?? 99,
    tax_free_threshold: map.get("tax_free_threshold_annual") ?? map.get("tax_free_threshold") ?? 100_000,
    min_wage_security: map.get("min_wage_security") ?? 16.0,
    // VET levy: 1% when ANNUAL payroll > N$1,000,000 (spec also references N$83,333 monthly ≈ same)
    vet_threshold: map.get("vet_levy_monthly_threshold") ?? 83_333,
    vet_rate: map.get("vet_levy_rate") ?? map.get("vet_rate") ?? 0.01,
    night_premium_rate: map.get("night_premium_rate") ?? 0.06,
    overtime_multiplier: map.get("overtime_multiplier") ?? 1.5,
    sunday_multiplier: map.get("sunday_default_multiplier") ?? map.get("sunday_multiplier") ?? 2.0,
    sunday_agreed_multiplier: map.get("sunday_agreed_multiplier") ?? 1.5,
    public_holiday_multiplier: map.get("public_holiday_multiplier") ?? 2.0,
    weekly_ordinary_cap: map.get("weekly_ordinary_cap") ?? 60,
    periods_per_year: map.get("periods_per_year") ?? 12,
  };

  const brackets: PayeBracket[] = (bracketRows ?? []).map((b) => ({
    lower_bound: Number(b.lower_bound),
    upper_bound: b.upper_bound == null ? null : Number(b.upper_bound),
    base_tax: Number(b.base_tax),
    marginal_rate: Number(b.marginal_rate),
  }));

  return { constants, brackets };
}

// ---------- PAYE — annualise → tax → divide back to the period ----------
// periodsPerYear lets non-monthly cycles annualise correctly (12 for monthly).
export function calcPAYE(periodTaxable: number, brackets: PayeBracket[], periodsPerYear = 12): number {
  if (periodTaxable <= 0 || brackets.length === 0) return 0;
  const annual = periodTaxable * periodsPerYear;
  const b = brackets.find((x) => annual >= x.lower_bound && (x.upper_bound == null || annual < x.upper_bound));
  if (!b) return 0;
  const annualTax = b.base_tax + (annual - b.lower_bound) * b.marginal_rate;
  return Math.max(0, annualTax / periodsPerYear);
}

// ISO-week key (the week's Monday as YYYY-MM-DD). Computed from the date parts
// directly so the result is independent of the host machine's timezone.
export function weekKeyOf(d: string): string {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  const dow = dt.getUTCDay() || 7; // Mon=1..Sun=7
  dt.setUTCDate(dt.getUTCDate() - dow + 1);
  return dt.toISOString().slice(0, 10);
}

// Day-of-week (0 = Sunday) for a YYYY-MM-DD date, timezone-independent.
function dowOf(d: string): number {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

// Add n calendar days to a YYYY-MM-DD date, timezone-independent.
function addDaysISO(d: string, n: number): string {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Night band per Labour Act s.19: work between 20h00 and 07h00. Expressed as
// minutes-of-day, the band wraps midnight → [1200,1440) ∪ [0,420).
const NIGHT_EVENING_START = 20 * 60; // 1200
const NIGHT_MORNING_END = 7 * 60; // 420

// Where a shift begins, in minutes from midnight. Prefer the configured window;
// fall back to the period default (night shifts 19:00, everything else 07:00).
function shiftStartMin(st: ShiftLogRow["shift_types"]): number {
  if (st?.start_min != null) return Number(st.start_min);
  return st?.period === "night" ? 19 * 60 : 7 * 60;
}

function overlapMin(a: number, b: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(b, hi) - Math.max(a, lo));
}

// Split a worked interval [startMin, startMin+durationMin) into one segment per
// calendar day it touches, carrying the night-band minutes within each segment.
// dayOffset is the number of days after the shift's anchor date (0 = same day,
// 1 = the morning after a night shift that crossed midnight).
function shiftSegments(startMin: number, durationMin: number): Array<{ dayOffset: number; minutes: number; nightMinutes: number }> {
  const segs: Array<{ dayOffset: number; minutes: number; nightMinutes: number }> = [];
  const end = startMin + durationMin;
  let cur = startMin;
  while (cur < end) {
    const dayOffset = Math.floor(cur / 1440);
    const dayEndAbs = (dayOffset + 1) * 1440;
    const segEnd = Math.min(end, dayEndAbs);
    const a = cur - dayOffset * 1440; // minute-of-day start
    const z = segEnd - dayOffset * 1440; // minute-of-day end
    const nightMinutes = overlapMin(a, z, NIGHT_EVENING_START, 1440) + overlapMin(a, z, 0, NIGHT_MORNING_END);
    segs.push({ dayOffset, minutes: segEnd - cur, nightMinutes });
    cur = segEnd;
  }
  return segs;
}

// ---------- Bucketise shift logs ----------
// Date-driven: every paid hour is classified by the real calendar day it falls on,
// so a shift that crosses into a Sunday / public holiday earns the premium only for
// the hours that actually land there (Labour Act ss.19, 21). The night band (20h00–
// 07h00) is isolated from the shift's clock window for the +6% premium.
function bucketiseLogs(
  logs: ShiftLogRow[],
  suspensionDates: Set<string>,
  weeklyCap: number,
  warnings: string[],
  exemptWeekKeys: Set<string>,
  publicHolidayDates: Set<string>,
): PayslipBuckets {
  const b: PayslipBuckets = {
    normal_hours: 0, overtime_hours: 0, sunday_hours: 0,
    public_holiday_hours: 0, night_hours: 0, suspended_hours: 0,
  };

  // Ordinary (weekday, non-premium) hours per ISO week — split against the cap once
  // all logs are tallied. The weekly total alone decides normal vs overtime, so the
  // order of accumulation doesn't matter.
  const ordinaryByWeek = new Map<string, number>();
  const addOrdinary = (day: string, hours: number) => {
    const wk = weekKeyOf(day);
    ordinaryByWeek.set(wk, (ordinaryByWeek.get(wk) ?? 0) + hours);
  };

  for (const l of logs) {
    // Zero out suspended days
    if (suspensionDates.has(l.date) || l.status === "suspended_unpaid" || l.status === "no_show") {
      b.suspended_hours += Number(l.hours_worked || 0);
      continue;
    }
    if (l.status === "replaced_by_other") continue;
    // Only approved attendance is paid. 'submitted' (awaiting payroll approval)
    // and 'pending' are excluded until approved.
    if (l.status !== "approved") continue;

    const hrs = Number(l.hours_worked || 0);
    const rule = l.shift_types?.pay_rule ?? "standard";

    if (rule === "off") continue;
    if (rule === "leave") {
      // Leave is paid at 1x as normal hours regardless of which day it lands on,
      // and carries no night premium.
      b.normal_hours += hrs;
      continue;
    }

    const segs = shiftSegments(shiftStartMin(l.shift_types), hrs * 60);
    let nightMinutes = 0;
    for (const s of segs) nightMinutes += s.nightMinutes;
    b.night_hours += nightMinutes / 60;

    if (rule === "sunday_default" || rule === "sunday_ordinary") {
      // Explicit Sunday shift type — operator deliberately marked the whole shift Sunday.
      b.sunday_hours += hrs;
      continue;
    }
    if (rule === "public_holiday_ordinary" || rule === "public_holiday_non_ordinary") {
      b.public_holiday_hours += hrs;
      continue;
    }

    // Standard shift — classify each segment by its real calendar day.
    for (const s of segs) {
      const day = addDaysISO(l.date, s.dayOffset);
      const hours = s.minutes / 60;
      if (publicHolidayDates.has(day)) {
        b.public_holiday_hours += hours;
      } else if (dowOf(day) === 0) {
        b.sunday_hours += hours;
      } else {
        addOrdinary(day, hours);
      }
    }
  }

  // Split each week's ordinary hours against the cap (first `weeklyCap` are normal,
  // the rest are overtime). Labour Act: weeks exceeding the cap need a Permanent
  // Secretary exemption — flag any uncovered week so payroll surfaces the risk.
  for (const [wk, hours] of ordinaryByWeek) {
    b.normal_hours += Math.min(hours, weeklyCap);
    b.overtime_hours += Math.max(0, hours - weeklyCap);
    if (hours > weeklyCap && !exemptWeekKeys.has(wk)) {
      warnings.push(`Week of ${wk}: ${hours.toFixed(1)}h exceeds the ${weeklyCap}h/week cap without a PS exemption`);
    }
  }
  return b;
}

// ---------- Full calculator ----------
export type AdhocDeductionRow = {
  employee_id: string;
  amount: number;
  requires_ca?: boolean;
  has_ca_ref?: boolean;
  label?: string;
};

export function calculateNetPay(args: {
  employee: EmployeeRow;
  logs: ShiftLogRow[];
  disciplinary: DisciplinaryRow[];
  adhocDeductions?: AdhocDeductionRow[];
  consensualDeductions?: number;
  suspensionDates?: Set<string>;
  psExemptWeekKeys?: Set<string>;
  publicHolidayDates?: Set<string>;
  // CEO toggle (tenants.night_premium_enabled). When false the +6% night premium is
  // suppressed — night hours are still tracked, only the money is zeroed.
  nightPremiumEnabled?: boolean;
  constants: PayrollConstants;
  brackets: PayeBracket[];
}): PayslipCalc {
  const { employee, logs, disciplinary, constants, brackets } = args;
  const consensual = round2(args.consensualDeductions ?? 0);
  const adhoc = args.adhocDeductions ?? [];
  const suspensionDates = args.suspensionDates ?? new Set<string>();
  const exemptWeekKeys = args.psExemptWeekKeys ?? new Set<string>();
  const publicHolidayDates = args.publicHolidayDates ?? new Set<string>();
  const nightPremiumEnabled = args.nightPremiumEnabled ?? true;
  const warnings: string[] = [];

  const isManagement = employee.category === "management" && Number(employee.monthly_salary || 0) > 0;

  const buckets = isManagement
    ? { normal_hours: 0, overtime_hours: 0, sunday_hours: 0, public_holiday_hours: 0, night_hours: 0, suspended_hours: 0 }
    : bucketiseLogs(logs, suspensionDates, constants.weekly_ordinary_cap, warnings, exemptWeekKeys, publicHolidayDates);

  const rate = Number(employee.hourly_rate) || constants.min_wage_security;

  if (!isManagement && rate < constants.min_wage_security) {
    warnings.push(`Rate N$${rate} below statutory minimum N$${constants.min_wage_security}`);
  }

  // Every monetary component is rounded to cents before summing so the stored
  // gross/deductions/net are exact and satisfy net === gross - deductions.
  const normal_amount = round2(isManagement
    ? Number(employee.monthly_salary || 0)
    : buckets.normal_hours * rate);
  const overtime_amount = isManagement ? 0 : round2(buckets.overtime_hours * rate * constants.overtime_multiplier);
  // Employees who ordinarily work Sundays under a written agreement are paid the reduced
  // Sunday multiplier (1.5× by default); everyone else gets the 2× default.
  const sundayMultiplier = employee.ordinarily_works_sundays
    ? constants.sunday_agreed_multiplier
    : constants.sunday_multiplier;
  const sunday_amount = isManagement ? 0 : round2(buckets.sunday_hours * rate * sundayMultiplier);
  const public_holiday_amount = isManagement ? 0 : round2(buckets.public_holiday_hours * rate * constants.public_holiday_multiplier);
  const night_premium_amount = isManagement || !nightPremiumEnabled
    ? 0
    : round2(buckets.night_hours * rate * constants.night_premium_rate);

  const transport_allowance = round2(Number(employee.transport_allowance) || 0);

  const gross_salary = round2(
    normal_amount + overtime_amount + sunday_amount +
    public_holiday_amount + night_premium_amount + transport_allowance,
  );

  // Transport allowance is non-taxable; PAYE on earnings only
  const taxable = gross_salary - transport_allowance;

  const paye_amount = round2(calcPAYE(taxable, brackets, constants.periods_per_year));
  const ssc_amount = round2(Math.min(gross_salary * constants.ssc_rate, constants.ssc_max_deduction));

  // Fines — require CA ref (Labour Act s.12(5))
  let fine_deductions = 0;
  let disqualified_fines = 0;
  for (const d of disciplinary) {
    if (d.action_type === "fine_with_ca") {
      const amt = Number(d.fine_amount || 0);
      if (d.collective_agreement_reference && d.collective_agreement_reference.trim()) {
        fine_deductions += amt;
      } else if (amt > 0) {
        disqualified_fines += amt;
        warnings.push(`Fine N$${amt} for ${d.offence_code} lacks Collective Agreement ref — set to N$0`);
      }
    }
  }

  // Ad-hoc incident deductions from deductions table (recorded on attendance / disciplinary)
  for (const d of adhoc) {
    const amt = Number(d.amount || 0);
    if (amt <= 0) continue;
    if (d.requires_ca && !d.has_ca_ref) {
      disqualified_fines += amt;
      warnings.push(`Deduction N$${amt}${d.label ? ` (${d.label})` : ""} requires Collective Agreement ref — set to N$0`);
    } else {
      fine_deductions += amt;
    }
  }
  fine_deductions = round2(fine_deductions);
  disqualified_fines = round2(disqualified_fines);

  const total_deductions = round2(paye_amount + ssc_amount + fine_deductions + consensual);
  const net_salary = round2(gross_salary - total_deductions);

  return {
    ...buckets,
    employee, rate,
    normal_amount, overtime_amount, sunday_amount,
    public_holiday_amount, night_premium_amount, transport_allowance,
    gross_salary, paye_amount, ssc_amount,
    fine_deductions, disqualified_fines,
    consensual_deductions: consensual,
    total_deductions, net_salary,
    warnings,
  };
}

export function calcVETLevy(totalGross: number, c: PayrollConstants): number {
  return totalGross > c.vet_threshold ? totalGross * c.vet_rate : 0;
}
