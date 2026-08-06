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
): number {
  const nightAdder = isNightPeriod ? shiftHours * hourlyRate * constants.night_premium_rate : 0;
  // Anything costed here is a shift being *rostered*, so a Sunday always attracts the
  // agreed multiplier — the 2× default only ever applies to a replacement called in later,
  // which by definition isn't on the roster yet. Keeps the cheapest-guard ranking honest.
  if (payRule === "sunday_default" || payRule === "sunday_ordinary") {
    const sundayMult = constants.sunday_agreed_multiplier ?? constants.sunday_multiplier;
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
  status:
    | "pending"
    | "submitted"
    | "approved"
    | "no_show"
    | "replaced_by_other"
    | "suspended_unpaid";
  // True when this shift came from an assignment created to cover someone else — i.e. the
  // guard was called in, not rostered. That's what makes a Sunday "unplanned" (#10): the
  // reduced 1.5× agreed multiplier only applies to Sundays the guard agreed to work.
  schedule_assignments?: { is_replacement: boolean; planned_hours?: number | null } | null;
  shift_types?: {
    code?: string | null;
    is_leave?: boolean | null;
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
  days_per_week?: number | null;
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
  // Reduced Sunday multiplier for work the employee agreed in advance to do (Labour Act
  // s.21 — 1.5× instead of the 2× default). This tenant applies it to everyone via the
  // employment contract; the default is reserved for replacement call-ins. Public
  // holidays are not covered by that agreement and stay at 2× for everyone.
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
  annual_leave_hours: number;
  sick_leave_hours: number;
  compassionate_leave_hours: number;
  maternity_leave_hours: number;
  maternity_paid_hours: number;
  unpaid_leave_hours: number;
  // Sunday hours the guard was rostered for — paid at the agreed multiplier (1.5×).
  sunday_hours: number;
  // Sunday hours worked as cover for someone else — always the full default multiplier,
  // because the guard never agreed to work that Sunday (#10).
  sunday_callin_hours: number;
  // Public holidays are not split — everyone gets the 2× default whether rostered or not.
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
  sunday_callin_amount: number;
  public_holiday_amount: number;
  night_premium_amount: number;
  transport_allowance: number;
  // Set only when the allowance was prorated, so the payslip can show the basis.
  transport_days_worked?: number | null;
  transport_expected_days?: number | null;
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

export async function fetchPayrollConstants(): Promise<{
  constants: PayrollConstants;
  brackets: PayeBracket[];
}> {
  const [{ data: constRows, error: cErr }, { data: bracketRows, error: bErr }] = await Promise.all([
    supabase.from("payroll_constants").select("key,value"),
    supabase
      .from("paye_brackets")
      .select("lower_bound,upper_bound,base_tax,marginal_rate")
      .order("lower_bound"),
  ]);
  if (cErr) throw cErr;
  if (bErr) throw bErr;

  const map = new Map<string, number>();
  (constRows ?? []).forEach((r) => map.set(r.key, Number(r.value)));

  const constants: PayrollConstants = {
    ssc_rate: map.get("ssc_employee_rate") ?? map.get("ssc_rate") ?? 0.009,
    ssc_max_deduction: map.get("ssc_max_deduction") ?? 99,
    tax_free_threshold:
      map.get("tax_free_threshold_annual") ?? map.get("tax_free_threshold") ?? 100_000,
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
export function calcPAYE(
  periodTaxable: number,
  brackets: PayeBracket[],
  periodsPerYear = 12,
): number {
  if (periodTaxable <= 0 || brackets.length === 0) return 0;
  const annual = periodTaxable * periodsPerYear;
  const b = brackets.find(
    (x) => annual >= x.lower_bound && (x.upper_bound == null || annual < x.upper_bound),
  );
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
function shiftSegments(
  startMin: number,
  durationMin: number,
): Array<{ dayOffset: number; minutes: number; nightMinutes: number }> {
  const segs: Array<{ dayOffset: number; minutes: number; nightMinutes: number }> = [];
  const end = startMin + durationMin;
  let cur = startMin;
  while (cur < end) {
    const dayOffset = Math.floor(cur / 1440);
    const dayEndAbs = (dayOffset + 1) * 1440;
    const segEnd = Math.min(end, dayEndAbs);
    const a = cur - dayOffset * 1440; // minute-of-day start
    const z = segEnd - dayOffset * 1440; // minute-of-day end
    const nightMinutes =
      overlapMin(a, z, NIGHT_EVENING_START, 1440) + overlapMin(a, z, 0, NIGHT_MORNING_END);
    segs.push({ dayOffset, minutes: segEnd - cur, nightMinutes });
    cur = segEnd;
  }
  return segs;
}

// ---------- Transport allowance proration ----------
// Transport is a travel allowance: it pays for getting to and from work, so a guard who
// worked half their shifts should receive half of it. A "worked day" is one distinct
// calendar date with approved real work. Leave accrual itself is cycle-based; transport
// deliberately remains attendance-based because it reimburses travel.
export function countWorkedDays(logs: ShiftLogRow[]): number {
  const days = new Set<string>();
  for (const l of logs) {
    if (l.status !== "approved") continue;
    const rule = l.shift_types?.pay_rule ?? "standard";
    if (rule === "off" || rule === "leave") continue;
    if (Number(l.hours_worked || 0) <= 0) continue;
    days.add(String(l.date).slice(0, 10));
  }
  return days.size;
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
    normal_hours: 0,
    overtime_hours: 0,
    sunday_hours: 0,
    sunday_callin_hours: 0,
    public_holiday_hours: 0,
    night_hours: 0,
    suspended_hours: 0,
    annual_leave_hours: 0,
    sick_leave_hours: 0,
    compassionate_leave_hours: 0,
    maternity_leave_hours: 0,
    maternity_paid_hours: 0,
    unpaid_leave_hours: 0,
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

    if (l.shift_types?.is_leave || rule === "leave") {
      const leaveHours =
        l.shift_types?.code === "LEAVE-UNPAID" || l.shift_types?.code === "LEAVE-MATERNITY"
          ? Number(l.schedule_assignments?.planned_hours || 0)
          : hrs;
      if (l.shift_types?.code === "LEAVE-SICK") b.sick_leave_hours += leaveHours;
      else if (l.shift_types?.code === "LEAVE-COMPASSIONATE")
        b.compassionate_leave_hours += leaveHours;
      else if (l.shift_types?.code === "LEAVE-MATERNITY") {
        b.maternity_leave_hours += leaveHours;
        b.maternity_paid_hours += hrs;
      } else if (l.shift_types?.code === "LEAVE-UNPAID") b.unpaid_leave_hours += leaveHours;
      else b.annual_leave_hours += leaveHours;
      // Leave is paid at 1x as normal hours regardless of which day it lands on,
      // and carries no night premium.
      if (l.shift_types?.code !== "LEAVE-UNPAID") b.normal_hours += hrs;
      continue;
    }
    if (rule === "off") continue;

    // Cover shifts are the "unplanned" case: the guard was called in to replace an absentee
    // and never agreed to this day, so the contract's agreed rate doesn't reduce it (#10).
    const isCallIn = l.schedule_assignments?.is_replacement === true;
    const addSunday = (hours: number) => {
      if (isCallIn) b.sunday_callin_hours += hours;
      else b.sunday_hours += hours;
    };

    const segs = shiftSegments(shiftStartMin(l.shift_types), hrs * 60);
    let nightMinutes = 0;
    for (const s of segs) nightMinutes += s.nightMinutes;
    b.night_hours += nightMinutes / 60;

    if (rule === "sunday_default" || rule === "sunday_ordinary") {
      // Explicit Sunday shift type — operator deliberately marked the whole shift Sunday.
      addSunday(hrs);
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
        addSunday(hours);
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
      warnings.push(
        `Week of ${wk}: ${hours.toFixed(1)}h exceeds the ${weeklyCap}h/week cap without a PS exemption`,
      );
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
  // Days this employee was rostered to work in the period — the denominator for transport
  // proration. Omit (or 0) to keep the full allowance.
  rosteredDays?: number;
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

  const isManagement =
    employee.category === "management" && Number(employee.monthly_salary || 0) > 0;
  // Transport proration exclusion is a category rule, not a compensation-basis one — several
  // management employees are paid via hourly_rate (monthly_salary = 0), which made the
  // combined isManagement flag above miss them entirely for this specific exclusion (#6).
  const isManagementCategory = employee.category === "management";

  const buckets = isManagement
    ? {
        normal_hours: 0,
        overtime_hours: 0,
        sunday_hours: 0,
        sunday_callin_hours: 0,
        public_holiday_hours: 0,
        night_hours: 0,
        suspended_hours: 0,
        annual_leave_hours: 0,
        sick_leave_hours: 0,
        compassionate_leave_hours: 0,
        maternity_leave_hours: 0,
        maternity_paid_hours: 0,
        unpaid_leave_hours: 0,
      }
    : bucketiseLogs(
        logs,
        suspensionDates,
        constants.weekly_ordinary_cap,
        warnings,
        exemptWeekKeys,
        publicHolidayDates,
      );

  const rate = Number(employee.hourly_rate) || constants.min_wage_security;

  if (!isManagement && rate < constants.min_wage_security) {
    warnings.push(`Rate N$${rate} below statutory minimum N$${constants.min_wage_security}`);
  }

  // Every monetary component is rounded to cents before summing so the stored
  // gross/deductions/net are exact and satisfy net === gross - deductions.
  const normal_amount = round2(
    isManagement ? Number(employee.monthly_salary || 0) : buckets.normal_hours * rate,
  );
  const overtime_amount = isManagement
    ? 0
    : round2(buckets.overtime_hours * rate * constants.overtime_multiplier);
  // Rostered Sundays and public holidays are paid at the reduced agreed multiplier (1.5×)
  // for EVERY employee: this tenant's employment contract makes the s.21 agreement a
  // condition of hire, so there is no per-employee opt-in to consult. See
  // "SAAS building notes for this software.md" — this is a tenant policy, not a product
  // default, and the next customer must not inherit it.
  const sunday_amount = isManagement
    ? 0
    : round2(buckets.sunday_hours * rate * constants.sunday_agreed_multiplier);
  // Cover shifts are the exception the contract doesn't reach: the guard was called in to
  // replace an absentee, never agreed to that day, so the full default multiplier applies (#10).
  const sunday_callin_amount = isManagement
    ? 0
    : round2(buckets.sunday_callin_hours * rate * constants.sunday_multiplier);
  // Public holidays are 2× for everyone, rostered or not — the contract's agreed rate
  // covers Sundays only, so there is nothing to split here.
  const public_holiday_amount = isManagement
    ? 0
    : round2(buckets.public_holiday_hours * rate * constants.public_holiday_multiplier);
  const night_premium_amount =
    isManagement || !nightPremiumEnabled
      ? 0
      : round2(buckets.night_hours * rate * constants.night_premium_rate);

  // Prorated against the guard's own roster: did they work the days they were rostered for?
  // The denominator has to be rostered days, not a days_per_week × weeks estimate — guards
  // get off days, so a full month is ~22 worked days against a 6-day pattern's 25.7, and
  // the pattern basis would dock ~14% from every guard with perfect attendance.
  // No roster for the period means we can't judge attendance, so the full allowance stands;
  // management is excluded outright (monthly salary, no shift logs to measure).
  const fullTransport = Number(employee.transport_allowance) || 0;
  const rosteredDays = Number(args.rosteredDays || 0);
  let transport_allowance = round2(fullTransport);
  let transport_days_worked: number | null = null;
  let transport_expected_days: number | null = null;
  if (!isManagementCategory && fullTransport > 0 && rosteredDays > 0) {
    const worked = countWorkedDays(logs);
    transport_days_worked = worked;
    transport_expected_days = rosteredDays;
    // Never more than the full allowance — a guard covering extra shifts is paid for that
    // work through their hours, not by inflating a travel allowance.
    transport_allowance = round2(fullTransport * Math.min(1, worked / rosteredDays));
    if (worked < rosteredDays) {
      warnings.push(`Transport prorated: worked ${worked} of ${rosteredDays} rostered days`);
    }
  }

  const gross_salary = round2(
    normal_amount +
      overtime_amount +
      sunday_amount +
      sunday_callin_amount +
      public_holiday_amount +
      night_premium_amount +
      transport_allowance,
  );

  // Transport allowance is non-taxable; PAYE on earnings only
  const taxable = gross_salary - transport_allowance;

  const paye_amount = round2(calcPAYE(taxable, brackets, constants.periods_per_year));
  const ssc_amount = round2(
    Math.min(gross_salary * constants.ssc_rate, constants.ssc_max_deduction),
  );

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
        warnings.push(
          `Fine N$${amt} for ${d.offence_code} lacks Collective Agreement ref — set to N$0`,
        );
      }
    }
  }

  // Ad-hoc incident deductions from deductions table (recorded on attendance / disciplinary)
  for (const d of adhoc) {
    const amt = Number(d.amount || 0);
    if (amt <= 0) continue;
    if (d.requires_ca && !d.has_ca_ref) {
      disqualified_fines += amt;
      warnings.push(
        `Deduction N$${amt}${d.label ? ` (${d.label})` : ""} requires Collective Agreement ref — set to N$0`,
      );
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
    employee,
    rate,
    normal_amount,
    overtime_amount,
    sunday_amount,
    sunday_callin_amount,
    public_holiday_amount,
    night_premium_amount,
    transport_allowance,
    transport_days_worked,
    transport_expected_days,
    gross_salary,
    paye_amount,
    ssc_amount,
    fine_deductions,
    disqualified_fines,
    consensual_deductions: consensual,
    total_deductions,
    net_salary,
    warnings,
  };
}

export function calcVETLevy(totalGross: number, c: PayrollConstants): number {
  return totalGross > c.vet_threshold ? totalGross * c.vet_rate : 0;
}
