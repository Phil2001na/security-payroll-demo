import { supabase } from "@/integrations/supabase/client";
import type { PayeBracket, PayrollConstants } from "@/lib/payroll-engine";

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
  (constRows ?? []).forEach((row) => map.set(row.key, Number(row.value)));
  const constants: PayrollConstants = {
    ssc_rate: map.get("ssc_employee_rate") ?? map.get("ssc_rate") ?? 0.009,
    ssc_max_deduction: map.get("ssc_max_deduction") ?? 99,
    tax_free_threshold: map.get("tax_free_threshold_annual") ?? map.get("tax_free_threshold") ?? 100_000,
    min_wage_security: map.get("min_wage_security") ?? 16,
    vet_threshold: map.get("vet_levy_monthly_threshold") ?? 83_333,
    vet_rate: map.get("vet_levy_rate") ?? map.get("vet_rate") ?? 0.01,
    night_premium_rate: map.get("night_premium_rate") ?? 0.06,
    overtime_multiplier: map.get("overtime_multiplier") ?? 1.5,
    sunday_multiplier: map.get("sunday_default_multiplier") ?? map.get("sunday_multiplier") ?? 2,
    sunday_agreed_multiplier: map.get("sunday_agreed_multiplier") ?? 1.5,
    public_holiday_multiplier: map.get("public_holiday_multiplier") ?? 2,
    weekly_ordinary_cap: map.get("weekly_ordinary_cap") ?? 60,
    periods_per_year: map.get("periods_per_year") ?? 12,
  };
  const brackets: PayeBracket[] = (bracketRows ?? []).map((row) => ({
    lower_bound: Number(row.lower_bound),
    upper_bound: row.upper_bound == null ? null : Number(row.upper_bound),
    base_tax: Number(row.base_tax),
    marginal_rate: Number(row.marginal_rate),
  }));
  return { constants, brackets };
}
