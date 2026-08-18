-- Admin fallback for payroll run/finalize.
--
-- replace_draft_payroll / finalize_payroll_period were locked to role = 'payroll'
-- exclusively — not even admin could lock a period. If the payroll user is
-- unavailable or their account breaks, nobody can run payroll. Allow 'admin' as a
-- deliberate fallback; everything else in both functions is unchanged.

create or replace function public.replace_draft_payroll(p_period uuid, p_rows jsonb)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role not in ('payroll', 'admin') then
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
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role not in ('payroll', 'admin') then
    raise exception 'Not authorized to finalize payroll';
  end if;

  update public.payroll_runs
     set status = 'finalized', finalized_at = now()
   where pay_period_id = p_period and status = 'draft' and tenant_id = v_tenant;

  update public.pay_periods
     set status = 'locked', locked_at = now(), locked_by = auth.uid()
   where id = p_period and tenant_id = v_tenant;

  with worked as (
    select sl.employee_id, count(distinct sl.date)::numeric as days
      from public.shift_logs sl
      join public.shift_types st on st.id = sl.shift_type_id
      join public.employees   e  on e.id  = sl.employee_id
     where sl.pay_period_id = p_period
       and sl.tenant_id     = v_tenant
       and sl.status        = 'approved'
       and st.is_leave      = false
       and st.pay_rule      <> 'off'
       and e.status         = 'active'
       and e.category       = 'officer'
     group by sl.employee_id
  ), ins as (
    insert into public.leave_accruals (tenant_id, employee_id, pay_period_id, days_accrued)
    select v_tenant, w.employee_id, p_period, round((w.days / 12.0)::numeric, 4)
      from worked w
     where w.days > 0
    on conflict (employee_id, pay_period_id) do nothing
    returning employee_id, days_accrued
  )
  insert into public.leave_balances (tenant_id, employee_id, annual_days)
  select v_tenant, ins.employee_id, ins.days_accrued from ins
  on conflict (employee_id) do update
     set annual_days = public.leave_balances.annual_days + excluded.annual_days,
         updated_at = now();
end; $function$;
