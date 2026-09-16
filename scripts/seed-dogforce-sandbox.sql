-- DogForce Sandbox: a disposable copy of the DogForce tenant for the client's operations
-- manager to drive the system end to end without touching the real tenant.
--
-- Copies DogForce's configuration, sites, employees and leave state into a new tenant, then
-- seeds two pay periods:
--   * "August 2026 SANDBOX (21 Jul - 20 Aug)" - fully rostered with approved attendance, so
--     Run Payroll works immediately.
--   * "September 2026 SANDBOX (21 Aug - 20 Sep)" - open and empty, for the full
--     roster -> attendance -> approve -> run -> finalize flow (includes Heroes' Day, 26 Aug).
--
-- Roster: 30 sites x 6 guards (3 day, 3 night), each on a 2-on/1-off rotation with staggered
-- phases, so every site has exactly 2 day + 2 night guards every day. That pattern stays inside
-- every database roster rule: <= 5 twelve-hour shifts (60h) per ISO week, >= 10 rest days per
-- calendar month, and no Day shift the morning after a Night shift. The remaining 5 guards are
-- left unrostered as relief. Shifts use the tenant's standard DAY/NIGHT types, as the app's own
-- generator does - Sundays and holidays are classified by date in the engine, not by shift type.
--
-- The login is created separately (it carries a password and does not belong in the repo).
-- Refuses to run twice. Remove with: delete the tenant's rows table by table, or ask.

do $$
declare
  src constant uuid := 'fefcfdb2-29eb-4873-9778-be327b9c8d34';
  dst uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid();
  st_day uuid;
  st_night uuid;
  cycle_cols text;
begin
  if exists (select 1 from public.tenants where name = 'DogForce Sandbox') then
    raise exception 'DogForce Sandbox already exists';
  end if;

  create temp table m_site (old uuid primary key, new uuid not null) on commit drop;
  create temp table m_emp (old uuid primary key, new uuid not null) on commit drop;
  create temp table m_cycle (old uuid primary key, new uuid not null) on commit drop;
  create temp table m_st (old uuid primary key, new uuid not null) on commit drop;

  -- Tenant row: every setting copied, identity overridden.
  insert into public.tenants
  select (jsonb_populate_record(null::public.tenants, to_jsonb(t) || jsonb_build_object(
    'id', dst, 'name', 'DogForce Sandbox', 'legal_name', 'DOG FORCE SECURITY SERVICE (SANDBOX)',
    'created_at', now(), 'updated_at', now()))).*
  from public.tenants t where t.id = src;

  -- Tenant-level configuration.
  insert into public.payroll_constants
  select (jsonb_populate_record(null::public.payroll_constants, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', dst))).*
  from public.payroll_constants x where x.tenant_id = src;

  insert into public.paye_brackets
  select (jsonb_populate_record(null::public.paye_brackets, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', dst))).*
  from public.paye_brackets x where x.tenant_id = src;

  insert into public.leave_policies
  select (jsonb_populate_record(null::public.leave_policies, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', dst))).*
  from public.leave_policies x where x.tenant_id = src;

  insert into public.public_holidays
  select (jsonb_populate_record(null::public.public_holidays, to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', dst))).*
  from public.public_holidays x where x.tenant_id = src;

  insert into m_st select id, gen_random_uuid() from public.shift_types where tenant_id = src;
  insert into public.shift_types
  select (jsonb_populate_record(null::public.shift_types, to_jsonb(x) || jsonb_build_object('id', m.new, 'tenant_id', dst))).*
  from public.shift_types x join m_st m on m.old = x.id;

  select m.new into st_day from m_st m join public.shift_types s on s.id = m.old where s.code = 'DAY';
  select m.new into st_night from m_st m join public.shift_types s on s.id = m.old where s.code = 'NIGHT';
  if st_day is null or st_night is null then raise exception 'DAY/NIGHT shift types missing'; end if;

  -- Sites and people.
  insert into m_site select id, gen_random_uuid() from public.sites where tenant_id = src;
  insert into public.sites
  select (jsonb_populate_record(null::public.sites, to_jsonb(x) || jsonb_build_object('id', m.new, 'tenant_id', dst))).*
  from public.sites x join m_site m on m.old = x.id;

  insert into m_emp select id, gen_random_uuid() from public.employees where tenant_id = src;
  insert into public.employees
  select (jsonb_populate_record(null::public.employees, to_jsonb(x) || jsonb_build_object(
    'id', m.new, 'tenant_id', dst, 'home_site_id', (select new from m_site where old = x.home_site_id)))).*
  from public.employees x join m_emp m on m.old = x.id;

  -- Leave state, so balances and cycles read the same as DogForce's.
  -- leave_cycles has a generated column, so only the stored columns are listed.
  insert into m_cycle select id, gen_random_uuid() from public.leave_cycles where tenant_id = src;
  select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cycle_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'leave_cycles' and is_generated = 'NEVER';
  execute format(
    'insert into public.leave_cycles (%1$s) select %1$s from (
       select (jsonb_populate_record(null::public.leave_cycles, to_jsonb(x) || jsonb_build_object(
         ''id'', mc.new, ''tenant_id'', $1, ''employee_id'', me.new))).*
       from public.leave_cycles x
       join m_cycle mc on mc.old = x.id
       join m_emp me on me.old = x.employee_id) r', cycle_cols)
  using dst;

  insert into public.leave_balances
  select (jsonb_populate_record(null::public.leave_balances, to_jsonb(x) || jsonb_build_object(
    'id', gen_random_uuid(), 'tenant_id', dst, 'employee_id', me.new))).*
  from public.leave_balances x join m_emp me on me.old = x.employee_id;

  insert into public.leave_ledger
  select (jsonb_populate_record(null::public.leave_ledger, to_jsonb(x) || jsonb_build_object(
    'id', gen_random_uuid(), 'tenant_id', dst, 'employee_id', me.new,
    'cycle_id', (select new from m_cycle where old = x.cycle_id)))).*
  from public.leave_ledger x join m_emp me on me.old = x.employee_id;

  -- Staffing need: 2 day + 2 night guards at every site, every day of the week.
  insert into public.site_requirements (tenant_id, site_id, day_of_week, shift_kind, quantity_required)
  select dst, m.new, dow, kind::public.shift_kind, 2
  from m_site m cross join generate_series(0, 6) dow cross join (values ('day'), ('night')) k(kind);

  -- Pay periods (DogForce runs 21st -> 20th, paid on the 16th).
  insert into public.pay_periods (id, tenant_id, label, start_date, end_date, pay_date, status) values
    (p1, dst, 'August 2026 SANDBOX (21 Jul - 20 Aug)', '2026-07-21', '2026-08-20', '2026-09-16', 'open'),
    (p2, dst, 'September 2026 SANDBOX (21 Aug - 20 Sep)', '2026-08-21', '2026-09-20', '2026-10-16', 'open');

  -- Crew assignment: guards in employee-code order, six per site. Slots 0-2 are day guards,
  -- 3-5 night guards; slot mod 3 is the rotation phase.
  create temp table crew on commit drop as
  select e.id employee_id,
         s.new site_id,
         (rn - 1) % 6 slot
  from (select id, row_number() over (order by employee_code, surname, id) rn
          from public.employees where tenant_id = dst) e
  join (select new, row_number() over (order by x.code) - 1 idx
          from m_site m join public.sites x on x.id = m.old) s
    on s.idx = (e.rn - 1) / 6
  where e.rn <= 180;

  update public.employees e
     set home_site_id = c.site_id,
         preferred_shift = (case when c.slot < 3 then 'day' else 'night' end)::public.shift_preference
    from crew c where c.employee_id = e.id;
  update public.employees
     set preferred_shift = 'both'::public.shift_preference
   where tenant_id = dst and id not in (select employee_id from crew);

  -- Roster for period 1: 2 on, 1 off.
  insert into public.schedule_assignments (tenant_id, employee_id, site_id, date, shift_type_id, planned_hours)
  select dst, c.employee_id, c.site_id, d::date,
         case when c.slot < 3 then st_day else st_night end, 12
  from crew c
  cross join generate_series('2026-07-21'::date, '2026-08-20'::date, interval '1 day') d
  where ((d::date - '2026-07-21'::date) + c.slot % 3) % 3 <> 2
  order by d, c.employee_id;

  -- Attendance for period 1, recorded the way the Attendance page records an admin's muster:
  -- approved with planned hours, night shifts carrying their hours as night hours. About 2% are
  -- no-shows so the engine has something to exclude.
  insert into public.shift_logs (tenant_id, assignment_id, employee_id, pay_period_id, date, site_id,
                                 shift_type_id, hours_worked, night_hours, status, approved_at, notes)
  select dst, a.id, a.employee_id, p1, a.date, a.site_id, a.shift_type_id,
         case when ns then 0 else 12 end,
         case when ns or a.shift_type_id = st_day then 0 else 12 end,
         case when ns then 'no_show' else 'approved' end::public.shift_log_status,
         (a.date + time '19:00') at time zone 'Africa/Windhoek',
         case when ns then 'Sandbox seed: did not report for duty' end
  from (select a.*, (('x' || substr(md5(a.employee_id::text || a.date::text), 1, 8))::bit(32)::int % 50 = 0) ns
          from public.schedule_assignments a where a.tenant_id = dst) a;

  raise notice 'sandbox tenant %, period1 %, period2 %', dst, p1, p2;
end $$;
