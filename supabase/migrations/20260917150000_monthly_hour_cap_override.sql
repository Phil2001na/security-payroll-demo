-- UAT-05 — hard block on the monthly hour cap, with the admin emergency override from UAT-09.
--
-- Decision §5 of DECISIONS-2026-09-03.md: hard block with an admin-only emergency override,
-- and explicitly NOT a warning-only bypass. The block already existed on both
-- schedule_assignments and shift_logs; what was missing was the authorised way past it. Until
-- now the only way past the cap was to switch enforcement off for the whole tenant, which is
-- precisely the blanket bypass the decision rules out.
--
-- This migration does NOT change payroll_constants.monthly_cap_enforced for any tenant. That
-- switch stays exactly where each tenant has it — turning it on changes how a company rosters
-- and what it staffs, so it is their call and Philip's to make per tenant.
--
-- Two details worth stating:
--
-- 1. The override is keyed to (employee, date), so it covers the assignment or the shift log
--    for that guard on that day. The monthly cap is a month-long total, but the thing being
--    refused is always a single day's write, so the day is the right unit to authorise.
--
-- 2. consumed_assignment_id is only set when the refusal came from schedule_assignments. A
--    shift_logs write has no assignment row to point at, so it consumes the override with a
--    null link rather than pretending one exists.

create or replace function public.enforce_monthly_hour_cap()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_cap numeric;
  v_enforced numeric;
  v_total numeric;
  v_month_start date := date_trunc('month', new.date)::date;
  v_month_end date := (date_trunc('month', new.date) + interval '1 month - 1 day')::date;
  v_assignment uuid;
begin
  select value into v_enforced from public.payroll_constants
   where tenant_id = new.tenant_id and key = 'monthly_cap_enforced';
  if coalesce(v_enforced, 0) <> 1 then
    return new;  -- warn-only mode: the app surfaces it, the database stays out of the way
  end if;

  select value into v_cap from public.payroll_constants
   where tenant_id = new.tenant_id and key = 'monthly_hour_cap';
  v_cap := coalesce(v_cap, 240);

  if tg_table_name = 'schedule_assignments' then
    select coalesce(sum(sa.planned_hours), 0) into v_total
      from public.schedule_assignments sa
      join public.shift_types st on st.id = sa.shift_type_id
     where sa.employee_id = new.employee_id
       and sa.date between v_month_start and v_month_end
       and st.pay_rule not in ('off', 'leave')
       and sa.id <> new.id;
    v_total := v_total + coalesce(new.planned_hours, 0);
    v_assignment := new.id;
  else
    select coalesce(sum(sl.hours_worked), 0) into v_total
      from public.shift_logs sl
     where sl.employee_id = new.employee_id
       and sl.date between v_month_start and v_month_end
       and sl.status not in ('no_show', 'replaced_by_other')
       and sl.id <> new.id;
    v_total := v_total + coalesce(new.hours_worked, 0);
    v_assignment := null;
  end if;

  if v_total <= v_cap then
    return new;
  end if;

  -- UAT-09's override is the only authorised way past this. Single use, admin-recorded,
  -- carrying a reason and an explicit legal-risk acknowledgement.
  if public.consume_roster_override(
       new.tenant_id, new.employee_id, new.date, array['monthly_hours']::text[], v_assignment
     ) then
    return new;
  end if;

  raise exception
    'Monthly hour cap exceeded: this would put the guard on % hours in % (cap %)',
    round(v_total, 1), to_char(v_month_start, 'Mon YYYY'), round(v_cap, 1)
    using errcode = 'check_violation',
          -- Same machine-readable contract as enforce_roster_assignment_integrity, so the
          -- scheduler offers an override for exactly this rule.
          detail = 'monthly_hours',
          hint = 'An admin can authorise an emergency override for this guard on this date.';
end $fn$;

revoke all on function public.enforce_monthly_hour_cap() from public, anon;
