// Demo Payroll System Engine — Gross-to-Net Calculator
// Implements Labour Act + Income Tax calculations using live payroll_constants.
//
// Imports carry explicit .ts extensions because this module is also imported directly by the
// `run-payroll` Deno edge function, which does not do extension resolution.
import {
  DEFAULT_SUNDAY_BOUNDARY_MODE,
  addDaysISO,
  dayOfWeekISO,
  segmentShift,
  type SegmentDayRule,
  type ShiftSegment,
  type SundayBoundaryMode,
} from "./shift-segments.ts";
import {
  evaluateSundayConsent,
  sundayFallbackWarning,
  sundayMultiplierForBasis,
  type SundayConsentEmployee,
  type SundayPayBasis,
} from "./sunday-consent.ts";

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
  // Anything costed here is a shift being *rostered*, so a Sunday is costed at the agreed
  // multiplier. This is a ranking estimate, not pay: the actual payslip charges 2× for a
  // replacement call-in, and also for a guard whose standing Sunday consent can't be
  // verified, so the estimate can understate that guard's real cost.
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
  // Evidence for the reduced 1.5x Sunday rate (UAT decision #7). Optional so existing
  // callers and fixtures keep compiling; absent evidence is exactly the case that falls
  // back to the statutory 2x.
  sunday_agreement_url?: string | null;
  contract_signed_at?: string | null;
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
  // s.21 — 1.5× instead of the 2× default). It applies only where that standing consent can
  // actually be verified for the employee (see sunday-consent.ts); where it cannot, and for
  // replacement call-ins, the 2× default applies. Public holidays are not covered by the
  // agreement and stay at 2× for everyone.
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
  // Which Sunday basis was applied and what it was worth — decisions #6/#7 need these on
  // the payslip and in the audit trail, not just implied by the amount.
  sunday_basis: SundayPayBasis;
  sunday_consent_verified: boolean;
  sunday_multiplier_applied: number;
  sunday_base_rate: number;
  sunday_base_rate_source: "employee_ordinary_rate" | "manual_period_entry";
  // Full internal-segment breakdown of every stored shift in the period.
  breakdown: PayrollCalculationBreakdown;
};

// ---------- Constants fetch ----------

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

// Where a shift begins, in minutes from midnight. Prefer the configured window;
// fall back to the period default (night shifts 19:00, everything else 07:00).
export function shiftStartMin(st: ShiftLogRow["shift_types"]): number {
  if (st?.start_min != null) return Number(st.start_min);
  return st?.period === "night" ? 19 * 60 : 7 * 60;
}

// ---------- Segment audit lines ----------
// One line per internal payroll segment of one stored shift. These are a *calculation*
// artefact: the roster and attendance records keep a single row for the shift, and the
// segments only ever describe how that one row was paid (UAT decision #2).
export type PayrollSegmentLine = {
  shift_log_id: string;
  // The stored shift as it sits in shift_logs — anchor date and derived clock window.
  shift_date: string;
  shift_starts_at: string;
  shift_ends_at: string;
  shift_hours: number;
  crosses_midnight: boolean;
  segment_index: number;
  segment_date: string;
  segment_start: string;
  segment_end: string;
  hours: number;
  night_hours: number;
  // The segment's own calendar day rule, and the rule the configured Sunday boundary mode
  // actually paid it under. They differ whenever the mode moved the segment.
  calendar_rule: SegmentDayRule;
  applied_rule: SegmentDayRule;
  rule_reason?: string;
  boundary_mode: SundayBoundaryMode;
  // Which pay bucket the segment's hours landed in. "ordinary" hours go into the weekly
  // pool that the 60h cap later splits into normal vs overtime, so the split is a weekly
  // outcome and deliberately not attributed to an individual segment here.
  pay_category: "ordinary" | "sunday" | "sunday_callin" | "public_holiday";
};

export type PayrollCalculationBreakdown = {
  boundary_mode: SundayBoundaryMode;
  sunday_basis: SundayPayBasis;
  sunday_consent_verified: boolean;
  sunday_consent_evidence: string;
  sunday_consent_reasons: string[];
  sunday_multiplier_applied: number;
  sunday_callin_multiplier_applied: number;
  sunday_base_rate: number;
  sunday_base_rate_source: "employee_ordinary_rate" | "manual_period_entry";
  segments: PayrollSegmentLine[];
  // Proof that segmentation neither lost nor duplicated a minute: these two must match.
  segment_integrity: {
    stored_minutes: number;
    segment_minutes: number;
    balanced: boolean;
  };
};

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
// Segment-driven: each stored shift is split internally at midnight (and therefore at the
// Sunday / public-holiday boundary), and every segment is paid under the day rule the
// configured Sunday boundary mode resolves for it (Labour Act ss.19, 21; UAT decisions
// #1/#2). The night band (20h00–07h00) is isolated from the shift's clock window for the
// +6% premium. The stored shift itself is only ever read.
function bucketiseLogs(
  logs: ShiftLogRow[],
  suspensionDates: Set<string>,
  weeklyCap: number,
  warnings: string[],
  exemptWeekKeys: Set<string>,
  publicHolidayDates: Set<string>,
  boundaryMode: SundayBoundaryMode,
): {
  buckets: PayslipBuckets;
  segments: PayrollSegmentLine[];
  storedMinutes: number;
  segmentMinutes: number;
} {
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

  const segmentLines: PayrollSegmentLine[] = [];
  let storedMinutes = 0;
  let segmentMinutes = 0;

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

    // An explicit Sunday / public-holiday shift type is an operator decision about the whole
    // shift, so it overrides the calendar and the boundary mode alike. The segments are still
    // produced and shown — the breakdown says which rule was forced and why.
    let forcedRule: SegmentDayRule | undefined;
    let forcedRuleReason: string | undefined;
    if (rule === "sunday_default" || rule === "sunday_ordinary") {
      forcedRule = "sunday";
      forcedRuleReason = `Shift type pay rule "${rule}" fixes the whole shift to the Sunday rule`;
    } else if (rule === "public_holiday_ordinary" || rule === "public_holiday_non_ordinary") {
      forcedRule = "public_holiday";
      forcedRuleReason = `Shift type pay rule "${rule}" fixes the whole shift to the public-holiday rule`;
    }

    const shiftDate = String(l.date).slice(0, 10);
    const segmentation = segmentShift({
      anchorDate: shiftDate,
      startMin: shiftStartMin(l.shift_types),
      durationMinutes: hrs * 60,
      boundaryMode,
      publicHolidayDates,
      forcedRule,
      forcedRuleReason,
    });
    for (const warning of segmentation.warnings) warnings.push(warning);
    storedMinutes += Math.max(0, hrs * 60);
    segmentMinutes += segmentation.totals.minutes;
    b.night_hours += segmentation.totals.nightMinutes / 60;

    for (const segment of segmentation.segments) {
      const hours = segment.minutes / 60;
      let payCategory: PayrollSegmentLine["pay_category"];
      if (segment.appliedRule === "public_holiday") {
        b.public_holiday_hours += hours;
        payCategory = "public_holiday";
      } else if (segment.appliedRule === "sunday") {
        if (isCallIn) {
          b.sunday_callin_hours += hours;
          payCategory = "sunday_callin";
        } else {
          b.sunday_hours += hours;
          payCategory = "sunday";
        }
      } else {
        addOrdinary(segment.date, hours);
        payCategory = "ordinary";
      }
      segmentLines.push(segmentLine(l.id, segmentation, segment, payCategory));
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
  return { buckets: b, segments: segmentLines, storedMinutes, segmentMinutes };
}

// One audit line for one internal segment of one stored shift.
function segmentLine(
  shiftLogId: string,
  segmentation: ReturnType<typeof segmentShift>,
  segment: ShiftSegment,
  payCategory: PayrollSegmentLine["pay_category"],
): PayrollSegmentLine {
  return {
    shift_log_id: shiftLogId,
    shift_date: segmentation.anchorDate,
    shift_starts_at: segmentation.startsAt,
    shift_ends_at: segmentation.endsAt,
    shift_hours: round2(segmentation.durationMinutes / 60),
    crosses_midnight: segmentation.crossesMidnight,
    segment_index: segment.index,
    segment_date: segment.date,
    segment_start: segment.startClock,
    segment_end: segment.endClock,
    hours: segment.hours,
    night_hours: segment.nightMinutes / 60,
    calendar_rule: segment.calendarRule,
    applied_rule: segment.appliedRule,
    ...(segment.ruleReason ? { rule_reason: segment.ruleReason } : {}),
    boundary_mode: segmentation.boundaryMode,
    pay_category: payCategory,
  };
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
  // How a shift straddling the Sunday boundary is paid (UAT decision #1). Configuration,
  // not a constant: the applicable legal interpretation is still with the client and their
  // labour counsel. Omitted means the mode the engine has always used.
  sundayBoundaryMode?: SundayBoundaryMode;
  // Sunday base rate payroll entered by hand for this pay period (UAT decision #5). When
  // set it replaces the employee's ordinary hourly rate as the base that Sunday premium
  // hours are calculated on; everything else stays on the ordinary rate. Omitted (or null)
  // means the ordinary rate is the Sunday base, which is the existing behaviour.
  sundayBaseRate?: number | null;
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
  const boundaryMode = args.sundayBoundaryMode ?? DEFAULT_SUNDAY_BOUNDARY_MODE;
  const warnings: string[] = [];

  // What entitles this employee's Sundays to the reduced 1.5x, if anything (decision #7).
  // No verifiable standing consent means the statutory 2x, not a silent discount.
  const sundayConsent = evaluateSundayConsent(employee as SundayConsentEmployee);

  const isManagement =
    employee.category === "management" && Number(employee.monthly_salary || 0) > 0;
  // Transport proration exclusion is a category rule, not a compensation-basis one — several
  // management employees are paid via hourly_rate (monthly_salary = 0), which made the
  // combined isManagement flag above miss them entirely for this specific exclusion (#6).
  const isManagementCategory = employee.category === "management";

  const emptySegmentation = {
    segments: [] as PayrollSegmentLine[],
    storedMinutes: 0,
    segmentMinutes: 0,
  };
  const bucketised = isManagement
    ? { buckets: null, ...emptySegmentation }
    : bucketiseLogs(
        logs,
        suspensionDates,
        constants.weekly_ordinary_cap,
        warnings,
        exemptWeekKeys,
        publicHolidayDates,
        boundaryMode,
      );

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
    : (bucketised.buckets as PayslipBuckets);

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
  // The base every Sunday premium hour is calculated on. Normally the employee's ordinary
  // hourly rate; where payroll entered a Sunday base rate for the period by hand (decision
  // #5) that entry is the base instead, and the breakdown records which was used.
  const manualSundayBase = Number(args.sundayBaseRate);
  const useManualSundayBase =
    args.sundayBaseRate != null && Number.isFinite(manualSundayBase) && manualSundayBase >= 0;
  const sunday_base_rate = useManualSundayBase ? round2(manualSundayBase) : rate;
  const sunday_base_rate_source = useManualSundayBase
    ? ("manual_period_entry" as const)
    : ("employee_ordinary_rate" as const);

  // Rostered Sundays are paid at the reduced agreed multiplier (1.5×) only where the
  // standing contract consent behind it can actually be verified. Where it cannot, the
  // statutory 2× default applies and the reason travels with the payslip (decision #7).
  // This replaces the previous blanket 1.5×-for-everyone tenant policy — see UPDATES.md.
  const sunday_multiplier_applied = sundayMultiplierForBasis(sundayConsent.basis, constants);
  const sunday_amount = isManagement
    ? 0
    : round2(buckets.sunday_hours * sunday_base_rate * sunday_multiplier_applied);
  // Cover shifts are the exception the contract doesn't reach: the guard was called in to
  // replace an absentee, never agreed to that day, so the full default multiplier applies (#10).
  const sunday_callin_amount = isManagement
    ? 0
    : round2(buckets.sunday_callin_hours * sunday_base_rate * constants.sunday_multiplier);

  if (!isManagement && buckets.sunday_hours > 0) {
    const fallback = sundayFallbackWarning(sundayConsent, constants);
    if (fallback) warnings.push(fallback);
  }
  if (useManualSundayBase && round2(manualSundayBase) !== round2(rate)) {
    warnings.push(
      `Sunday hours paid on a manually entered base rate of N$${sunday_base_rate.toFixed(2)} instead of the calculated ordinary rate N$${round2(rate).toFixed(2)}`,
    );
  }
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
    sunday_basis: sundayConsent.basis,
    sunday_consent_verified: sundayConsent.consentVerified,
    sunday_multiplier_applied,
    sunday_base_rate,
    sunday_base_rate_source,
    breakdown: {
      boundary_mode: boundaryMode,
      sunday_basis: sundayConsent.basis,
      sunday_consent_verified: sundayConsent.consentVerified,
      sunday_consent_evidence: sundayConsent.evidence,
      sunday_consent_reasons: sundayConsent.reasons,
      sunday_multiplier_applied,
      sunday_callin_multiplier_applied: constants.sunday_multiplier,
      sunday_base_rate,
      sunday_base_rate_source,
      segments: bucketised.segments,
      segment_integrity: {
        stored_minutes: bucketised.storedMinutes,
        segment_minutes: bucketised.segmentMinutes,
        // Compared on whole minutes: worked hours are decimal, so the two sides can differ
        // by float dust without a minute having actually gone missing.
        balanced: Math.abs(bucketised.storedMinutes - bucketised.segmentMinutes) < 1e-6,
      },
    },
  };
}

export function calcVETLevy(totalGross: number, c: PayrollConstants): number {
  return totalGross > c.vet_threshold ? totalGross * c.vet_rate : 0;
}
