-- Leave accrual driven by ACTUAL days worked, not a pre-set days_per_week.
--
-- Replaces the previous model (every active officer accrued days_per_week × 4 / 12
-- each finalized period regardless of attendance). Security schedules are irregular —
-- a fixed days_per_week guessed at onboarding was both a guess payroll had to make and
-- unfair: two officers who worked very differently accrued identical leave.
--
-- New rule (Labour Act s.23 — 4 weeks' leave per leave cycle): an officer who works a
-- full year (~48 worked weeks) earns ~4 weeks of leave, so the schedule-independent
-- rate is 1 leave day per 12 days actually worked. We accrue worked_days / 12 each
-- finalized period, counting only APPROVED attendance on real working days (off-days
-- and leave days don't earn leave). This self-corrects: whoever works more days earns
-- proportionally more leave, with no onboarding configuration and nobody favoured.
--
-- Idempotent across re-finalizes via leave_accruals' unique (employee_id, pay_period_id).

CREATE OR REPLACE FUNCTION public.finalize_payroll_period(p_period uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Accrue leave from actual worked days: 1 leave day per 12 days worked.
  -- A "worked day" is a distinct calendar date with an approved shift log whose pay
  -- rule is real work (any rule except 'off'; leave shift types are excluded). Only
  -- active officers accrue (management / monthly-salary staff are skipped). Only newly
  -- inserted ledger rows bump the balance, so re-finalizing a period is a no-op.
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
