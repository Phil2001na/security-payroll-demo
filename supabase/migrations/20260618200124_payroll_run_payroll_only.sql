-- replace_draft_payroll/finalize_payroll_period checked role in ('admin','operations','accountant'),
-- which never included 'payroll' — the role meant to own this action — and let 'accountant'
-- through even though the payroll page itself is admin/operations/payroll only. Restrict both
-- to 'payroll' exclusively (separation of duties: payroll runs payroll, nobody else).
create or replace function public.replace_draft_payroll(p_period uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role <> 'payroll' then
    raise exception 'Not authorized to run payroll';
  end if;

  delete from public.payroll_runs
   where pay_period_id = p_period and status = 'draft' and tenant_id = v_tenant;

  insert into public.payroll_runs (
    tenant_id, employee_id, pay_period_id, normal_hours, overtime_hours, sunday_hours,
    public_holiday_hours, night_hours, rate_per_hour, normal_amount, overtime_amount,
    sunday_amount, public_holiday_amount, night_premium_amount, transport_allowance,
    gross_salary, paye_amount, ssc_amount, consensual_deductions, total_deductions,
    net_salary, compliance_warnings, status)
  select
    v_tenant, (r->>'employee_id')::uuid, p_period,
    (r->>'normal_hours')::numeric, (r->>'overtime_hours')::numeric, (r->>'sunday_hours')::numeric,
    (r->>'public_holiday_hours')::numeric, (r->>'night_hours')::numeric, (r->>'rate_per_hour')::numeric,
    (r->>'normal_amount')::numeric, (r->>'overtime_amount')::numeric, (r->>'sunday_amount')::numeric,
    (r->>'public_holiday_amount')::numeric, (r->>'night_premium_amount')::numeric, (r->>'transport_allowance')::numeric,
    (r->>'gross_salary')::numeric, (r->>'paye_amount')::numeric, (r->>'ssc_amount')::numeric,
    (r->>'consensual_deductions')::numeric, (r->>'total_deductions')::numeric, (r->>'net_salary')::numeric,
    coalesce(r->'compliance_warnings', '[]'::jsonb), 'draft'
  from jsonb_array_elements(p_rows) as r;
end; $function$;

create or replace function public.finalize_payroll_period(p_period uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role <> 'payroll' then
    raise exception 'Not authorized to finalize payroll';
  end if;

  update public.payroll_runs
     set status = 'finalized', finalized_at = now()
   where pay_period_id = p_period and status = 'draft' and tenant_id = v_tenant;

  update public.pay_periods
     set status = 'locked', locked_at = now(), locked_by = auth.uid()
   where id = p_period and tenant_id = v_tenant;
end; $function$;
