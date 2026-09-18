-- Annual leave accrues from days ACTUALLY WORKED, not from employees.days_per_week.
--
-- 20260628120000 established this rule and gave the reasoning: a days_per_week guessed at
-- onboarding is both a guess payroll has to make and unfair, because two officers who worked
-- very differently accrue identical leave. 20260803181750_leave_management_module rewrote
-- finalize_payroll_period wholesale and reverted it without saying so -- the deployed function
-- accrues a daily fraction of days_per_week * 4 across the employment period, so an officer
-- accrues on rest days, on unpaid suspension, and on days nobody rostered them.
--
-- The revert is also arithmetically unreachable. Four hard roster rules bound scheduling:
-- 12h per day, 60h per ISO week, at most 6 working days per week, at least 10 rest days per
-- calendar month. With 12-hour shifts the weekly hour cap binds first -- 60 / 12 = 5 shifts --
-- so a six-day week of full shifts is refused before the six-day rule is ever consulted. The
-- default days_per_week of 6 therefore promises 24 days a year for a pattern the system will
-- not build.
--
-- Rule restored: one leave day per twelve days worked. Over a full year (~48 worked weeks) that
-- earns four weeks at whatever pattern the officer actually worked -- 5 days/wk -> 240 worked
-- days -> 20 leave days; 6 days/wk -> 288 -> 24 -- so it satisfies Labour Act s.23 without
-- reading a pattern off the employee record at all. days_per_week is left in place as a
-- scheduling availability ceiling, and keeps its Act-mandated role in SICK leave (30 days for a
-- five-day week, 36 for a six-day week over 36 months), which is genuinely pattern-based.
--
-- Idempotent across re-finalizes via leave_accruals' unique (employee_id, pay_period_id).
-- Everything else in both functions is preserved exactly as deployed.

CREATE OR REPLACE FUNCTION public.finalize_payroll_period(p_period uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid:=get_my_tenant_id(); v_role text:=get_my_role(); v_start date; v_end date; v_employee record;
begin
  if (select auth.uid()) is null or v_tenant is null or v_role not in ('payroll','admin') then
    raise exception 'Not authorized to finalize payroll';
  end if;
  select start_date,end_date into v_start,v_end from pay_periods
  where id=p_period and tenant_id=v_tenant and status='open' for update;
  if not found then raise exception 'Open payroll period not found'; end if;
  if not exists(select 1 from payroll_runs where pay_period_id=p_period and tenant_id=v_tenant and status='draft') then
    raise exception 'Run draft payroll before finalizing the period';
  end if;

  update payroll_runs set status='finalized',finalized_at=now()
  where pay_period_id=p_period and status='draft' and tenant_id=v_tenant;

  for v_employee in select id from employees where tenant_id=v_tenant and status<>'terminated' and category='officer' loop
    perform private.ensure_statutory_leave_cycles(v_tenant,v_employee.id,v_end);
  end loop;

  -- One leave day per twelve days worked. A worked day is a distinct calendar date carrying an
  -- approved shift log on a real working shift type -- leave types and 'off' earn nothing. No
  -- employment_exits cutoff is needed: a leaver has no approved logs past their last working day,
  -- so the rule caps itself.
  with worked as (
    select sl.employee_id, count(distinct sl.date)::numeric days
    from shift_logs sl
    join shift_types st on st.id=sl.shift_type_id
    join employees   e  on e.id =sl.employee_id
    where sl.pay_period_id=p_period and sl.tenant_id=v_tenant and sl.status='approved'
      and st.is_leave=false and st.pay_rule<>'off'
      and e.category='officer'
    group by sl.employee_id
  ), ins as (
    insert into leave_accruals(tenant_id,employee_id,pay_period_id,days_accrued)
    select v_tenant,w.employee_id,p_period,round((w.days/12.0)::numeric,4) from worked w
    where w.days>0
    on conflict(employee_id,pay_period_id) do nothing
    returning employee_id,days_accrued
  )
  insert into leave_balances(tenant_id,employee_id,annual_days)
  select v_tenant,employee_id,days_accrued from ins
  on conflict(employee_id) do update set annual_days=leave_balances.annual_days+excluded.annual_days,updated_at=now();

  update pay_periods set status='locked',locked_at=now(),locked_by=(select auth.uid())
  where id=p_period and tenant_id=v_tenant;
end $function$;

-- The annual cycle's entitlement_units figure is informational -- the annual branch never posts
-- to leave_ledger or leave_balances (v_delta is 0 for annual, and the top-up block skips it), so
-- the real balance comes from the accrual above. But it is what the leave planner shows as the
-- officer's entitlement for the cycle, and reading it off days_per_week made it disagree with the
-- ledger. It now mirrors the accrual rule. The sick branch keeps its pattern basis, which the Act
-- prescribes, and the first-year 1-per-26 branch is untouched.
CREATE OR REPLACE FUNCTION private.ensure_statutory_leave_cycles(p_tenant uuid, p_employee uuid, p_as_of date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type public.leave_type; v_start date; v_cycle_start date; v_cycle_end date;
  v_cycle_months integer; v_elapsed integer; v_entitlement numeric; v_existing public.leave_cycles;
  v_balance numeric; v_delta numeric; v_worked numeric; v_days_per_week numeric; v_has_prior boolean;
begin
  select coalesce(e.start_date,e.created_at::date),least(6,greatest(1,e.days_per_week))
    into v_start,v_days_per_week
  from public.employees e where e.id=p_employee and e.tenant_id=p_tenant;
  if not found then raise exception 'Employee not found'; end if;

  foreach v_type in array array['annual'::public.leave_type,'sick'::public.leave_type,'compassionate'::public.leave_type] loop
    v_cycle_months := case when v_type='sick' then 36 else 12 end;
    v_elapsed := greatest(0,(extract(year from age(p_as_of,v_start))::integer*12)+extract(month from age(p_as_of,v_start))::integer);
    v_cycle_start := (v_start + make_interval(months => (v_elapsed/v_cycle_months)*v_cycle_months))::date;
    v_cycle_end := (v_cycle_start + make_interval(months => v_cycle_months) - interval '1 day')::date;

    if v_type='annual' then
      select round(coalesce(count(distinct sl.date),0)::numeric/12.0,2) into v_entitlement
      from public.shift_logs sl join public.shift_types st on st.id=sl.shift_type_id
      where sl.employee_id=p_employee and sl.tenant_id=p_tenant and sl.status='approved'
        and sl.date between v_cycle_start and p_as_of and not st.is_leave and st.pay_rule<>'off';
    elsif v_type='compassionate' then
      v_entitlement := 5;
    elsif p_as_of < v_start + interval '1 year' then
      select floor(count(distinct sl.date)::numeric/26) into v_worked
      from public.shift_logs sl join public.shift_types st on st.id=sl.shift_type_id
      where sl.employee_id=p_employee and sl.tenant_id=p_tenant and sl.status='approved'
        and sl.date between v_start and p_as_of and not st.is_leave and st.pay_rule<>'off';
      v_entitlement := coalesce(v_worked,0);
    else
      v_entitlement := round(v_days_per_week*6,2);
    end if;

    select * into v_existing from public.leave_cycles
    where employee_id=p_employee and leave_type=v_type and cycle_start=v_cycle_start for update;
    if found then
      if v_entitlement>v_existing.entitlement_units then
        update public.leave_cycles set entitlement_units=v_entitlement where id=v_existing.id;
        if v_type<>'annual' then
          v_delta:=v_entitlement-v_existing.entitlement_units;
          insert into public.leave_ledger(tenant_id,employee_id,leave_type,entry_type,units,cycle_id,reference,effective_date)
          values(p_tenant,p_employee,v_type,'adjustment',v_delta,v_existing.id,'Statutory entitlement top-up',p_as_of);
          perform private.apply_leave_balance(p_tenant,p_employee,v_type,v_delta);
        end if;
      end if;
      continue;
    end if;

    select exists(select 1 from public.leave_cycles where employee_id=p_employee and leave_type=v_type)
      into v_has_prior;
    if v_type<>'annual' then
      v_balance:=coalesce(private.leave_balance_value(p_tenant,p_employee,v_type),0);
      if v_has_prior and v_balance<>0 then
        insert into public.leave_ledger(tenant_id,employee_id,leave_type,entry_type,units,reference,effective_date)
        values(p_tenant,p_employee,v_type,'expiry',-v_balance,'Unused balance expired at statutory cycle end',v_cycle_start);
        perform private.apply_leave_balance(p_tenant,p_employee,v_type,-v_balance);
      end if;
    end if;

    insert into public.leave_cycles(tenant_id,employee_id,leave_type,cycle_start,cycle_end,entitlement_units)
    values(p_tenant,p_employee,v_type,v_cycle_start,v_cycle_end,v_entitlement) returning * into v_existing;
    v_delta := case
      when v_type='annual' then 0
      when v_has_prior then v_entitlement
      else greatest(0,v_entitlement-greatest(v_balance,0))
    end;
    if v_delta>0 then
      insert into public.leave_ledger(tenant_id,employee_id,leave_type,entry_type,units,cycle_id,reference,effective_date)
      values(p_tenant,p_employee,v_type,'entitlement',v_delta,v_existing.id,'Statutory cycle entitlement',v_cycle_start);
      perform private.apply_leave_balance(p_tenant,p_employee,v_type,v_delta);
    end if;
  end loop;
end $function$;
