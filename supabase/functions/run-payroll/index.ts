import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateNetPay,
  round2,
  weekKeyOf,
  type AdhocDeductionRow,
  type DisciplinaryRow,
  type EmployeeRow,
  type PayeBracket,
  type PayrollConstants,
  type ShiftLogRow,
} from "../../../src/lib/payroll-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type PageResult<T> = { data: T[] | null; error: unknown };

// Reads a query page by page until a short page comes back. The query must have a stable order.
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<PageResult<T>> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < size) return { data: rows, error: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Server is missing required configuration." }, 500);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Unauthorized." }, 401);
  const jwt = authorization.slice("Bearer ".length);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData.user) return json({ error: "Unauthorized." }, 401);

  const body = await req.json().catch(() => null) as { periodId?: string } | null;
  const periodId = body?.periodId;
  if (!periodId) return json({ error: "periodId is required." }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id, role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.is_active || !["payroll", "admin"].includes(profile.role)) {
    return json({ error: "Access denied. Payroll access is required." }, 403);
  }
  const tenantId: string = profile.tenant_id;

  const { data: period, error: periodErr } = await admin
    .from("pay_periods")
    .select("id, start_date, end_date, status")
    .eq("id", periodId)
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .maybeSingle();
  if (periodErr || !period) return json({ error: "Open payroll period not found." }, 404);

  // PostgREST caps every response at 1000 rows, and a month of shift logs for a real guard
  // force is several thousand. Without paging, everything past row 1000 was silently left
  // out and those shifts were never paid. Every list below is read to the end.
  const [constantsRes, bracketsRes, employeesRes, logsRes, disciplinaryRes, deductionsRes, exemptionsRes, holidaysRes, assignmentsRes, tenantRes] = await Promise.all([
    fetchAll((from, to) => admin.from("payroll_constants").select("key,value,value_text").eq("tenant_id", tenantId).order("key").range(from, to)),
    fetchAll((from, to) => admin.from("paye_brackets").select("lower_bound,upper_bound,base_tax,marginal_rate").eq("tenant_id", tenantId).order("lower_bound").range(from, to)),
    fetchAll((from, to) => admin.from("employees").select("*").eq("tenant_id", tenantId).eq("status", "active").order("id").range(from, to)),
    fetchAll((from, to) => admin.from("shift_logs").select("id,employee_id,date,hours_worked,night_hours,status,schedule_assignments:assignment_id(is_replacement,planned_hours),shift_types(code,is_leave,pay_rule,rate_multiplier,start_min,end_min,period)").eq("tenant_id", tenantId).eq("pay_period_id", period.id).order("id").range(from, to)),
    fetchAll((from, to) => admin.from("disciplinary_actions").select("id,employee_id,action_type,fine_amount,suspension_hours,collective_agreement_reference,offence_code,incident_date").eq("tenant_id", tenantId).eq("status", "confirmed").gte("incident_date", period.start_date).lte("incident_date", period.end_date).order("id").range(from, to)),
    fetchAll((from, to) => admin.from("deductions").select("id,employee_id,amount,disciplinary_action_id,deduction_types(code,label,category,requires_collective_agreement)").eq("tenant_id", tenantId).eq("pay_period_id", period.id).order("id").range(from, to)),
    fetchAll((from, to) => admin.from("ps_exemptions").select("id,employee_id,effective_from,effective_to").eq("tenant_id", tenantId).lte("effective_from", period.end_date).gte("effective_to", period.start_date).order("id").range(from, to)),
    fetchAll((from, to) => admin.from("public_holidays").select("id,date").eq("tenant_id", tenantId).order("id").range(from, to)),
    fetchAll((from, to) => admin.from("schedule_assignments").select("id,employee_id,date,leave_request_day_id,shift_types(pay_rule)").eq("tenant_id", tenantId).gte("date", period.start_date).lte("date", period.end_date).order("id").range(from, to)),
    admin.from("tenants").select("night_premium_enabled").eq("id", tenantId).maybeSingle(),
  ]);
  const results = [constantsRes, bracketsRes, employeesRes, logsRes, disciplinaryRes, deductionsRes, exemptionsRes, holidaysRes, assignmentsRes, tenantRes];
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    console.error("[run-payroll] Source query failed", failed.error);
    return json({ error: "Unable to load payroll source data." }, 500);
  }

  const constantMap = new Map<string, number>();
  const constantTextMap = new Map<string, string>();
  for (const row of constantsRes.data ?? []) constantMap.set(row.key, Number(row.value));
  for (const row of constantsRes.data ?? []) if (row.value_text) constantTextMap.set(row.key, row.value_text);
  const constants: PayrollConstants = {
    ssc_rate: constantMap.get("ssc_employee_rate") ?? constantMap.get("ssc_rate") ?? 0.009,
    ssc_max_deduction: constantMap.get("ssc_max_deduction") ?? 99,
    tax_free_threshold: constantMap.get("tax_free_threshold_annual") ?? constantMap.get("tax_free_threshold") ?? 100_000,
    min_wage_security: constantMap.get("min_wage_security") ?? 16,
    vet_threshold: constantMap.get("vet_levy_monthly_threshold") ?? 83_333,
    vet_rate: constantMap.get("vet_levy_rate") ?? constantMap.get("vet_rate") ?? 0.01,
    night_premium_rate: constantMap.get("night_premium_rate") ?? 0.06,
    overtime_multiplier: constantMap.get("overtime_multiplier") ?? 1.5,
    sunday_multiplier: constantMap.get("sunday_default_multiplier") ?? constantMap.get("sunday_multiplier") ?? 2,
    sunday_agreed_multiplier: constantMap.get("sunday_agreed_multiplier") ?? 1.5,
    public_holiday_multiplier: constantMap.get("public_holiday_multiplier") ?? 2,
    weekly_ordinary_cap: constantMap.get("weekly_ordinary_cap") ?? 60,
    periods_per_year: constantMap.get("periods_per_year") ?? 12,
    sunday_boundary_rule: constantTextMap.get("sunday_boundary_rule") === "majority_of_shift" ? "majority_of_shift" : "midnight_split",
  };
  const brackets: PayeBracket[] = (bracketsRes.data ?? []).map((row) => ({
    lower_bound: Number(row.lower_bound), upper_bound: row.upper_bound == null ? null : Number(row.upper_bound),
    base_tax: Number(row.base_tax), marginal_rate: Number(row.marginal_rate),
  }));

  const rosteredDaysByEmployee = new Map<string, Set<string>>();
  for (const assignment of assignmentsRes.data ?? []) {
    if (assignment.shift_types?.pay_rule === "off" && !assignment.leave_request_day_id) continue;
    const days = rosteredDaysByEmployee.get(assignment.employee_id) ?? new Set<string>();
    days.add(String(assignment.date).slice(0, 10));
    rosteredDaysByEmployee.set(assignment.employee_id, days);
  }
  const exemptWeeksByEmployee = new Map<string, Set<string>>();
  for (const exemption of exemptionsRes.data ?? []) {
    const weeks = exemptWeeksByEmployee.get(exemption.employee_id) ?? new Set<string>();
    for (let date = new Date(`${exemption.effective_from}T00:00:00Z`); date <= new Date(`${exemption.effective_to}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
      weeks.add(weekKeyOf(date.toISOString().slice(0, 10)));
    }
    exemptWeeksByEmployee.set(exemption.employee_id, weeks);
  }
  const suspensionByEmployee = new Map<string, Set<string>>();
  for (const action of disciplinaryRes.data ?? []) {
    if (action.action_type !== "unpaid_suspension") continue;
    const dates = suspensionByEmployee.get(action.employee_id) ?? new Set<string>();
    dates.add(String(action.incident_date));
    suspensionByEmployee.set(action.employee_id, dates);
  }
  const deductionsByEmployee = new Map<string, AdhocDeductionRow[]>();
  for (const deduction of deductionsRes.data ?? []) {
    const definition = Array.isArray(deduction.deduction_types) ? deduction.deduction_types[0] : deduction.deduction_types;
    const relatedAction = (disciplinaryRes.data ?? []).find((action) => action.id === deduction.disciplinary_action_id);
    const entries = deductionsByEmployee.get(deduction.employee_id) ?? [];
    entries.push({ employee_id: deduction.employee_id, amount: Number(deduction.amount ?? 0), requires_ca: !!definition?.requires_collective_agreement, has_ca_ref: deduction.disciplinary_action_id ? !!relatedAction?.collective_agreement_reference : true, label: definition?.label ?? undefined });
    deductionsByEmployee.set(deduction.employee_id, entries);
  }
  const publicHolidayDates = new Set((holidaysRes.data ?? []).map((row) => String(row.date).slice(0, 10)));
  // One employee's data must not sink the whole run. The engine throws deliberately in
  // cases that need a human answer (a tied majority-of-shift Sunday, for example), and an
  // uncaught throw here previously meant nobody in the tenant got a draft. Failures are
  // collected and reported instead of swallowed — an employee missing from the draft is a
  // fact payroll has to see, not one to discover on the payslip.
  const calculations: ReturnType<typeof calculateNetPay>[] = [];
  const failures: { employee_id: string; employee_code: string | null; name: string; reason: string }[] = [];
  for (const employee of employeesRes.data ?? []) {
    try {
      calculations.push(calculateNetPay({
        employee: employee as EmployeeRow,
        logs: (logsRes.data ?? []).filter((log) => log.employee_id === employee.id) as ShiftLogRow[],
        disciplinary: (disciplinaryRes.data ?? []).filter((action) => action.employee_id === employee.id) as DisciplinaryRow[],
        adhocDeductions: deductionsByEmployee.get(employee.id) ?? [],
        suspensionDates: suspensionByEmployee.get(employee.id),
        psExemptWeekKeys: exemptWeeksByEmployee.get(employee.id),
        publicHolidayDates,
        rosteredDays: rosteredDaysByEmployee.get(employee.id)?.size ?? 0,
        nightPremiumEnabled: tenantRes.data?.night_premium_enabled ?? true,
        constants,
        brackets,
      }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({
        employee_id: employee.id,
        employee_code: employee.employee_code ?? null,
        name: employee.display_name || [employee.first_names, employee.surname].filter(Boolean).join(" ") || employee.id,
        reason,
      });
      console.error("[run-payroll] Calculation failed for employee", employee.id, reason);
    }
  }
  const rows = calculations
    .filter((calculation) => calculation.gross_salary > 0 || calculation.total_deductions > 0 || calculation.employee.category === "management")
    .map((calculation) => ({
      employee_id: calculation.employee.id, normal_hours: calculation.normal_hours, overtime_hours: calculation.overtime_hours,
      annual_leave_hours: calculation.annual_leave_hours, sick_leave_hours: calculation.sick_leave_hours,
      compassionate_leave_hours: calculation.compassionate_leave_hours, maternity_leave_hours: calculation.maternity_leave_hours,
      maternity_paid_hours: calculation.maternity_paid_hours, unpaid_leave_hours: calculation.unpaid_leave_hours,
      sunday_hours: calculation.sunday_hours, sunday_callin_hours: calculation.sunday_callin_hours,
      public_holiday_hours: calculation.public_holiday_hours, night_hours: calculation.night_hours,
      rate_per_hour: calculation.rate, normal_amount: calculation.normal_amount, overtime_amount: calculation.overtime_amount,
      sunday_amount: calculation.sunday_amount, sunday_callin_amount: calculation.sunday_callin_amount,
      public_holiday_amount: calculation.public_holiday_amount, night_premium_amount: calculation.night_premium_amount,
      transport_allowance: calculation.transport_allowance, gross_salary: calculation.gross_salary,
      paye_amount: calculation.paye_amount, ssc_amount: calculation.ssc_amount,
      consensual_deductions: round2(calculation.consensual_deductions + calculation.fine_deductions),
      total_deductions: calculation.total_deductions, net_salary: calculation.net_salary,
      compliance_warnings: calculation.warnings,
      calculation_segments: calculation.calculation_segments,
    }));
  // The service-role client has no auth.uid(), so the tenant resolved from the caller's
  // profile above is passed explicitly; the RPC is executable by the service role only.
  const { error: saveErr } = await admin.rpc("replace_draft_payroll", { p_period: period.id, p_rows: rows, p_tenant: tenantId });
  if (saveErr) {
    console.error("[run-payroll] Persistence failed", saveErr);
    return json({ error: "Unable to save the payroll draft." }, 500);
  }
  return json({ calculations, failures });
});
