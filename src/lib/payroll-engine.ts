// Dog Force Payroll Engine — Namibia 2026
// Implements Labour Act + Income Tax calculations using live payroll_constants.
import { supabase } from "@/integrations/supabase/client";

export type ShiftLogRow = {
  id: string;
  employee_id: string;
  date: string;
  hours_worked: number;
  night_hours: number;
  status: "pending" | "approved" | "no_show" | "replaced_by_other" | "suspended_unpaid";
  shift_types?: { pay_rule: string; rate_multiplier: number } | null;
};

export type EmployeeRow = {
  id: string;
  employee_code: string;
  surname: string;
  first_names: string;
  display_name: string | null;
  hourly_rate: number;
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
  };

  const brackets: PayeBracket[] = (bracketRows ?? []).map((b) => ({
    lower_bound: Number(b.lower_bound),
    upper_bound: b.upper_bound == null ? null : Number(b.upper_bound),
    base_tax: Number(b.base_tax),
    marginal_rate: Number(b.marginal_rate),
  }));

  return { constants, brackets };
}

// ---------- PAYE — monthly (annualise → tax → /12) ----------
export function calcPAYE(monthlyTaxable: number, brackets: PayeBracket[]): number {
  if (monthlyTaxable <= 0 || brackets.length === 0) return 0;
  const annual = monthlyTaxable * 12;
  const b = brackets.find((x) => annual >= x.lower_bound && (x.upper_bound == null || annual < x.upper_bound));
  if (!b) return 0;
  const annualTax = b.base_tax + (annual - b.lower_bound) * b.marginal_rate;
  return Math.max(0, annualTax / 12);
}

// ---------- Bucketise shift logs ----------
function bucketiseLogs(logs: ShiftLogRow[], suspensionDates: Set<string>): PayslipBuckets {
  const b: PayslipBuckets = {
    normal_hours: 0, overtime_hours: 0, sunday_hours: 0,
    public_holiday_hours: 0, night_hours: 0, suspended_hours: 0,
  };

  // Week map — ISO week of date → hours (for OT calc).
  const weekHours = new Map<string, number>();
  const weekKey = (d: string) => {
    const dt = new Date(d + "T00:00:00Z");
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() - day + 1);
    return dt.toISOString().slice(0, 10);
  };

  // Sort chronologically for correct weekly OT accumulation.
  const sorted = [...logs].sort((a, z) => a.date.localeCompare(z.date));

  for (const l of sorted) {
    // Zero out suspended days
    if (suspensionDates.has(l.date) || l.status === "suspended_unpaid" || l.status === "no_show") {
      b.suspended_hours += Number(l.hours_worked || 0);
      continue;
    }
    if (l.status === "replaced_by_other") continue;

    const hrs = Number(l.hours_worked || 0);
    const nightHrs = Number(l.night_hours || 0);
    const rule = l.shift_types?.pay_rule ?? "standard";

    b.night_hours += nightHrs;

    if (rule === "sunday_default" || rule === "sunday_ordinary") {
      b.sunday_hours += hrs;
    } else if (rule === "public_holiday_ordinary" || rule === "public_holiday_non_ordinary") {
      b.public_holiday_hours += hrs;
    } else if (rule === "leave" || rule === "off") {
      // leave paid at 1x as normal hours; off days do not accumulate
      if (rule === "leave") b.normal_hours += hrs;
    } else {
      // standard — split across 60h/week threshold for OT
      const wk = weekKey(l.date);
      const prior = weekHours.get(wk) ?? 0;
      const newTotal = prior + hrs;
      if (prior >= 60) {
        b.overtime_hours += hrs;
      } else if (newTotal > 60) {
        b.normal_hours += 60 - prior;
        b.overtime_hours += newTotal - 60;
      } else {
        b.normal_hours += hrs;
      }
      weekHours.set(wk, newTotal);
    }
  }
  return b;
}

// ---------- Full calculator ----------
export function calculateNetPay(args: {
  employee: EmployeeRow;
  logs: ShiftLogRow[];
  disciplinary: DisciplinaryRow[];
  consensualDeductions?: number;
  suspensionDates?: Set<string>;
  constants: PayrollConstants;
  brackets: PayeBracket[];
}): PayslipCalc {
  const { employee, logs, disciplinary, constants, brackets } = args;
  const consensual = args.consensualDeductions ?? 0;
  const suspensionDates = args.suspensionDates ?? new Set<string>();
  const warnings: string[] = [];

  const buckets = bucketiseLogs(logs, suspensionDates);
  const rate = Number(employee.hourly_rate) || constants.min_wage_security;

  if (rate < constants.min_wage_security) {
    warnings.push(`Rate N$${rate} below statutory minimum N$${constants.min_wage_security}`);
  }

  const normal_amount = buckets.normal_hours * rate;
  const overtime_amount = buckets.overtime_hours * rate * constants.overtime_multiplier;
  const sunday_amount = buckets.sunday_hours * rate * constants.sunday_multiplier;
  const public_holiday_amount = buckets.public_holiday_hours * rate * constants.sunday_multiplier;
  const night_premium_amount = buckets.night_hours * rate * constants.night_premium_rate;

  const transport_allowance = Number(employee.transport_allowance) || 0;

  const gross_salary =
    normal_amount + overtime_amount + sunday_amount +
    public_holiday_amount + night_premium_amount + transport_allowance;

  // Transport allowance is non-taxable; PAYE on earnings only
  const taxable = gross_salary - transport_allowance;

  const paye_amount = calcPAYE(taxable, brackets);
  const ssc_amount = Math.min(gross_salary * constants.ssc_rate, constants.ssc_max_deduction);

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

  const total_deductions = paye_amount + ssc_amount + fine_deductions + consensual;
  const net_salary = gross_salary - total_deductions;

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
