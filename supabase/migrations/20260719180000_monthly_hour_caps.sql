-- Monthly hour ceilings (tracker #7): 240 total hours and 20 overtime hours per calendar
-- month. The 12h daily cap is already a CHECK constraint (20260617120000) — this is the
-- same idea for a limit that spans rows, so it has to be a trigger rather than a CHECK.
--
-- IMPORTANT — it ships disabled. The client's current rosters already exceed 240h (July 2026:
-- 9 guards rostered over, max 276h; June: 20 guards, max 264h), because a 6-day × 12h pattern
-- is ~264h+. Turning the block on therefore changes how they roster and probably what they
-- staff, so it's their decision, not a default. Until `monthly_cap_enforced` is set to 1 the
-- app warns and the database allows the write.

insert into public.payroll_constants (tenant_id, key, value, description)
select t.id, c.key, c.value, c.description
from public.tenants t
cross join (values
  ('monthly_hour_cap',      240, 'Maximum total hours per guard per calendar month'),
  ('monthly_overtime_cap',   20, 'Maximum overtime hours per guard per calendar month'),
  ('monthly_cap_enforced',    0, '1 = database rejects writes past the monthly hour cap; 0 = warn only')
) as c(key, value, description)
where not exists (
  select 1 from public.payroll_constants pc where pc.tenant_id = t.id and pc.key = c.key
);

create or replace function public.enforce_monthly_hour_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cap numeric;
  v_enforced numeric;
  v_total numeric;
  v_month_start date := date_trunc('month', new.date)::date;
  v_month_end date := (date_trunc('month', new.date) + interval '1 month - 1 day')::date;
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
  else
    select coalesce(sum(sl.hours_worked), 0) into v_total
      from public.shift_logs sl
     where sl.employee_id = new.employee_id
       and sl.date between v_month_start and v_month_end
       and sl.status not in ('no_show', 'replaced_by_other')
       and sl.id <> new.id;
    v_total := v_total + coalesce(new.hours_worked, 0);
  end if;

  if v_total > v_cap then
    raise exception
      'Monthly hour cap exceeded: this would put the guard on % hours in % (cap %)',
      round(v_total, 1), to_char(v_month_start, 'Mon YYYY'), round(v_cap, 1)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger schedule_assignments_monthly_hour_cap
  before insert or update of planned_hours, date, employee_id, shift_type_id
  on public.schedule_assignments
  for each row execute function public.enforce_monthly_hour_cap();

create trigger shift_logs_monthly_hour_cap
  before insert or update of hours_worked, date, employee_id, status
  on public.shift_logs
  for each row execute function public.enforce_monthly_hour_cap();

revoke all on function public.enforce_monthly_hour_cap() from public, anon;
