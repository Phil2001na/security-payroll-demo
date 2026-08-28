-- UAT 2026-08-20 decisions #1, #2, #5, #6 and #8 — configurable Sunday boundary, an
-- auditable segment breakdown, and the manual Sunday base rate with its acknowledgement gate.
--
-- Everything here is ADDITIVE and backwards-compatible:
--   * no column is dropped or retyped, and no historical payroll or roster row is rewritten;
--   * the new payroll_constants row seeds the mode the engine has always used, so existing
--     periods recalculate to exactly the figures they produce today;
--   * payroll_runs gains a nullable-by-default jsonb column, so rows written before this
--     migration read back as an empty breakdown rather than failing;
--   * finalize_payroll_period keeps its existing body and gains one new guard, which is a
--     no-op for any period with no manually entered Sunday base rate.
--
-- Why the migration is needed at all: decision #1 makes the Sunday boundary rule a client
-- setting rather than a constant, decision #5 gives payroll a per-period Sunday base rate to
-- store, decision #6 requires the acknowledgement of a rate difference to be recorded with
-- its actor, timestamp and values, and decision #8 requires the internal segment calculation
-- to be auditable after the fact. None of that has anywhere to live in the current schema.

-- ── 1. Sunday boundary mode (decision #1) ────────────────────────────────────
-- payroll_constants.value is numeric, so the mode is stored as a code. Keep in step with
-- SUNDAY_BOUNDARY_MODE_CODES in src/lib/shift-segments.ts:
--   0 = midnight_split      — split at midnight, each side paid under its own calendar day
--   1 = majority_of_shift   — whole shift follows the day holding most of its hours (s.21(8))
--   2 = shift_start_day     — whole shift follows the calendar day it started on
-- Seeded at 0 deliberately: that is what the engine does today, so this migration changes
-- nobody's pay. The applicable interpretation is still with the client and labour counsel.
insert into public.payroll_constants (tenant_id, key, value, description)
select t.id, 'sunday_boundary_mode', 0,
       'How a shift crossing into or out of Sunday is paid: 0 = split at midnight (current), 1 = whole shift follows the day holding most of its hours (Labour Act s.21(8)), 2 = whole shift follows the day it started on. Ties under mode 1 resolve to the higher-rate day.'
  from public.tenants t
 where not exists (
   select 1 from public.payroll_constants pc
    where pc.tenant_id = t.id and pc.key = 'sunday_boundary_mode'
 );

-- New tenants get the row too, so the constant is editable in Admin -> Settings from day
-- one. Seeding lives in its own trigger rather than inside handle_new_user() to keep this
-- migration additive; fold it into that function next time it is edited.
create or replace function public.seed_sunday_boundary_mode()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.payroll_constants (tenant_id, key, value, description)
  values (new.id, 'sunday_boundary_mode', 0,
          'How a shift crossing into or out of Sunday is paid: 0 = split at midnight (current), 1 = whole shift follows the day holding most of its hours (Labour Act s.21(8)), 2 = whole shift follows the day it started on. Ties under mode 1 resolve to the higher-rate day.')
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_seed_sunday_boundary_mode on public.tenants;
create trigger trg_seed_sunday_boundary_mode
  after insert on public.tenants
  for each row execute function public.seed_sunday_boundary_mode();

-- ── 2. Auditable calculation breakdown (decisions #2, #8) ────────────────────
-- One jsonb document per payroll run holding the internal segments each stored shift was
-- paid under, the Sunday basis applied, and the segment-integrity proof. These are a
-- calculation artefact: the roster and attendance records still hold ONE row per shift, and
-- nothing in this migration creates a second operational shift for a midnight crossing.
alter table public.payroll_runs
  add column if not exists calculation_breakdown jsonb not null default '{}'::jsonb;

comment on column public.payroll_runs.calculation_breakdown is
  'Internal payroll segments, Sunday basis and segment-integrity proof for this run. Audit output only — the stored shift_logs row for a midnight-crossing shift is never split.';

-- ── 3. Manual Sunday base rate per pay period (decisions #5, #6) ─────────────
create table if not exists public.payroll_sunday_rates (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  pay_period_id               uuid not null references public.pay_periods(id) on delete cascade,
  -- The rate payroll entered by hand, and the ordinary rate the system calculated for the
  -- same period. Both are kept so the difference stays reconstructable long after the run.
  sunday_base_rate            numeric(12,4) not null check (sunday_base_rate >= 0),
  calculated_ordinary_rate    numeric(12,4) not null check (calculated_ordinary_rate >= 0),
  entered_by                  uuid references auth.users(id),
  entered_at                  timestamptz not null default now(),
  note                        text,
  -- Acknowledgement of the difference (decision #6): who, when, against which values, and
  -- optionally why. Null until an authorised user takes it on the record.
  acknowledged_by             uuid references auth.users(id),
  acknowledged_at             timestamptz,
  acknowledged_rate           numeric(12,4),
  acknowledged_ordinary_rate  numeric(12,4),
  acknowledgement_reason      text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- One Sunday base rate per pay period.
  unique (pay_period_id)
);

create index if not exists idx_payroll_sunday_rates_tenant
  on public.payroll_sunday_rates(tenant_id);

alter table public.payroll_sunday_rates enable row level security;

-- Readable by the tenant, like every other payroll table. Deliberately NO insert/update/
-- delete policy: all writes go through the SECURITY DEFINER RPCs below, which is what makes
-- "only an authorised user may acknowledge" a database guarantee rather than a UI habit.
drop policy if exists payroll_sunday_rates_select on public.payroll_sunday_rates;
create policy payroll_sunday_rates_select on public.payroll_sunday_rates
  for select using (tenant_id = public.get_my_tenant_id());

-- Same audit trigger every other money-bearing table carries.
drop trigger if exists trg_audit_payroll_sunday_rates on public.payroll_sunday_rates;
create trigger trg_audit_payroll_sunday_rates
  after insert or update or delete on public.payroll_sunday_rates
  for each row execute function public.write_audit_event();

-- ── 4. Enter / clear the Sunday base rate ───────────────────────────────────
-- Entering a rate that differs from the calculated ordinary rate is explicitly allowed:
-- decision #5 says a difference warns, it does not block. What it does do is clear any
-- previous acknowledgement, because an acknowledgement only ever covers the values it was
-- given for — the new difference has to be taken on the record again.
create or replace function public.set_sunday_base_rate(
  p_period uuid,
  p_rate numeric,
  p_calculated_ordinary_rate numeric,
  p_note text default null
)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  v_role := public.get_my_role();
  if (select auth.uid()) is null or v_tenant is null or v_role not in ('payroll','admin') then
    raise exception 'Not authorized to set the Sunday base rate';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'Sunday base rate must be zero or more';
  end if;
  if not exists (
    select 1 from public.pay_periods
     where id = p_period and tenant_id = v_tenant and status = 'open'
  ) then
    raise exception 'Open payroll period not found';
  end if;

  insert into public.payroll_sunday_rates as psr (
    tenant_id, pay_period_id, sunday_base_rate, calculated_ordinary_rate,
    entered_by, entered_at, note)
  values (v_tenant, p_period, p_rate, coalesce(p_calculated_ordinary_rate, 0),
          (select auth.uid()), now(), p_note)
  on conflict (pay_period_id) do update
     set sunday_base_rate           = excluded.sunday_base_rate,
         calculated_ordinary_rate   = excluded.calculated_ordinary_rate,
         entered_by                 = excluded.entered_by,
         entered_at                 = excluded.entered_at,
         note                       = excluded.note,
         updated_at                 = now(),
         -- Re-entering the rate re-opens the warning.
         acknowledged_by            = null,
         acknowledged_at            = null,
         acknowledged_rate          = null,
         acknowledged_ordinary_rate = null,
         acknowledgement_reason     = null
   where psr.tenant_id = v_tenant;
end $$;

create or replace function public.clear_sunday_base_rate(p_period uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  v_role := public.get_my_role();
  if (select auth.uid()) is null or v_tenant is null or v_role not in ('payroll','admin') then
    raise exception 'Not authorized to clear the Sunday base rate';
  end if;
  if not exists (
    select 1 from public.pay_periods
     where id = p_period and tenant_id = v_tenant and status = 'open'
  ) then
    raise exception 'Open payroll period not found';
  end if;
  delete from public.payroll_sunday_rates
   where pay_period_id = p_period and tenant_id = v_tenant;
end $$;

-- ── 5. Acknowledge the rate warning (decision #6) ───────────────────────────
-- Restricted to the payroll and admin roles: nobody else may take this on payroll's behalf.
-- The acknowledgement records the actor, the timestamp, the two rate values it covers and an
-- optional reason, and the table's audit trigger writes all of it to audit_events.
create or replace function public.acknowledge_sunday_rate_variance(
  p_period uuid,
  p_reason text default null
)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_role text; v_row public.payroll_sunday_rates;
begin
  v_tenant := public.get_my_tenant_id();
  v_role := public.get_my_role();
  if (select auth.uid()) is null or v_tenant is null or v_role not in ('payroll','admin') then
    raise exception 'Not authorized to acknowledge the Sunday rate warning';
  end if;

  select * into v_row from public.payroll_sunday_rates
   where pay_period_id = p_period and tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'No Sunday base rate has been entered for this period';
  end if;
  -- Nothing to acknowledge where the entered rate already matches what was calculated.
  if abs(v_row.sunday_base_rate - v_row.calculated_ordinary_rate) < 0.005 then
    raise exception 'The entered Sunday base rate matches the calculated ordinary rate — there is nothing to acknowledge';
  end if;

  update public.payroll_sunday_rates
     set acknowledged_by            = (select auth.uid()),
         acknowledged_at            = now(),
         acknowledged_rate          = sunday_base_rate,
         acknowledged_ordinary_rate = calculated_ordinary_rate,
         acknowledgement_reason     = p_reason,
         updated_at                 = now()
   where pay_period_id = p_period and tenant_id = v_tenant;

  -- An explicit, human-readable audit line alongside the row-level audit event, so the
  -- acknowledgement is findable without diffing two jsonb snapshots.
  insert into public.audit_events (
    tenant_id, actor_id, actor_email, table_name, record_id, action, new_values, notes)
  select v_tenant, (select auth.uid()), p.email, 'payroll_sunday_rates', v_row.id,
         'ACKNOWLEDGE_SUNDAY_RATE_VARIANCE',
         jsonb_build_object(
           'pay_period_id', p_period,
           'sunday_base_rate', v_row.sunday_base_rate,
           'calculated_ordinary_rate', v_row.calculated_ordinary_rate,
           'difference', v_row.sunday_base_rate - v_row.calculated_ordinary_rate,
           'reason', p_reason),
         format('Sunday base rate %s acknowledged against calculated ordinary rate %s',
                v_row.sunday_base_rate, v_row.calculated_ordinary_rate)
    from public.profiles p where p.id = (select auth.uid());
end $$;

-- ── 6. Persist the calculation breakdown with the draft run ─────────────────
-- Identical to the existing replace_draft_payroll except for the added
-- calculation_breakdown column; kept whole so the running definition stays readable.
create or replace function public.replace_draft_payroll(p_period uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role not in ('payroll','admin') then raise exception 'Not authorized to run payroll'; end if;
  perform 1 from public.pay_periods
  where id=p_period and tenant_id=v_tenant and status='open'
  for update;
  if not found then raise exception 'Open payroll period not found'; end if;

  delete from public.payroll_runs where pay_period_id=p_period and status='draft' and tenant_id=v_tenant;
  insert into public.payroll_runs (
    tenant_id,employee_id,pay_period_id,normal_hours,overtime_hours,sunday_hours,sunday_callin_hours,
    public_holiday_hours,night_hours,annual_leave_hours,sick_leave_hours,compassionate_leave_hours,maternity_leave_hours,maternity_paid_hours,unpaid_leave_hours,
    rate_per_hour,normal_amount,overtime_amount,sunday_amount,sunday_callin_amount,public_holiday_amount,
    night_premium_amount,transport_allowance,gross_salary,paye_amount,ssc_amount,consensual_deductions,
    total_deductions,net_salary,compliance_warnings,calculation_breakdown,status)
  select v_tenant,(r->>'employee_id')::uuid,p_period,
    coalesce((r->>'normal_hours')::numeric,0),coalesce((r->>'overtime_hours')::numeric,0),
    coalesce((r->>'sunday_hours')::numeric,0),coalesce((r->>'sunday_callin_hours')::numeric,0),
    coalesce((r->>'public_holiday_hours')::numeric,0),coalesce((r->>'night_hours')::numeric,0),
    coalesce((r->>'annual_leave_hours')::numeric,0),coalesce((r->>'sick_leave_hours')::numeric,0),
    coalesce((r->>'compassionate_leave_hours')::numeric,0),coalesce((r->>'maternity_leave_hours')::numeric,0),
    coalesce((r->>'maternity_paid_hours')::numeric,0),coalesce((r->>'unpaid_leave_hours')::numeric,0),
    (r->>'rate_per_hour')::numeric,coalesce((r->>'normal_amount')::numeric,0),
    coalesce((r->>'overtime_amount')::numeric,0),coalesce((r->>'sunday_amount')::numeric,0),
    coalesce((r->>'sunday_callin_amount')::numeric,0),coalesce((r->>'public_holiday_amount')::numeric,0),
    coalesce((r->>'night_premium_amount')::numeric,0),coalesce((r->>'transport_allowance')::numeric,0),
    coalesce((r->>'gross_salary')::numeric,0),coalesce((r->>'paye_amount')::numeric,0),
    coalesce((r->>'ssc_amount')::numeric,0),coalesce((r->>'consensual_deductions')::numeric,0),
    coalesce((r->>'total_deductions')::numeric,0),coalesce((r->>'net_salary')::numeric,0),
    coalesce(r->'compliance_warnings','[]'::jsonb),coalesce(r->'calculation_breakdown','{}'::jsonb),'draft'
  from jsonb_array_elements(p_rows) r;
end $$;

-- ── 7. Finalize gate: an unacknowledged rate warning holds submission ───────
-- The existing body is unchanged; the guard below is inserted ahead of it. A period with no
-- manually entered Sunday base rate, or one whose entered rate matches what was calculated,
-- is completely unaffected — this only stops a period whose recorded difference nobody has
-- taken on the record yet (decision #6). It is never triggered by the difference alone
-- (decision #5): acknowledging clears it immediately.
create or replace function public.finalize_payroll_period(p_period uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_tenant uuid:=get_my_tenant_id(); v_role text:=get_my_role(); v_start date; v_end date; v_employee record; v_sunday record;
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

  -- UAT decision #6 — an entered Sunday base rate that differs from the calculated ordinary
  -- rate must be acknowledged by an authorised user before the period can be submitted.
  select * into v_sunday from payroll_sunday_rates
   where pay_period_id=p_period and tenant_id=v_tenant;
  if found and abs(v_sunday.sunday_base_rate - v_sunday.calculated_ordinary_rate) >= 0.005 then
    if v_sunday.acknowledged_by is null
       or v_sunday.acknowledged_rate is distinct from v_sunday.sunday_base_rate
       or v_sunday.acknowledged_ordinary_rate is distinct from v_sunday.calculated_ordinary_rate then
      raise exception 'The Sunday base rate (%) differs from the calculated ordinary rate (%). An authorised payroll user must acknowledge this before the period can be finalized.',
        v_sunday.sunday_base_rate, v_sunday.calculated_ordinary_rate;
    end if;
  end if;

  update payroll_runs set status='finalized',finalized_at=now()
  where pay_period_id=p_period and status='draft' and tenant_id=v_tenant;

  for v_employee in select id from employees where tenant_id=v_tenant and status<>'terminated' and category='officer' loop
    perform private.ensure_statutory_leave_cycles(v_tenant,v_employee.id,v_end);
  end loop;

  -- Sum an exact daily fraction of the employee's four-week entitlement. This avoids
  -- leap-year drift and correctly caps a confirmed leaver at the last working day.
  with eligible_employees as (
    select e.id employee_id,least(6,greatest(1,e.days_per_week))::numeric days_per_week,
      coalesce(e.start_date,v_start) employment_start,
      least(v_end,coalesce((
        select max(x.last_working_day) from employment_exits x
        where x.employee_id=e.id and x.tenant_id=v_tenant and x.status='confirmed'
          and (x.final_pay_period_id=p_period or x.last_working_day between v_start and v_end)
      ),v_end)) employment_end
    from employees e
    where e.tenant_id=v_tenant and e.category='officer'
      and coalesce(e.start_date,v_start)<=v_end
      and (e.status<>'terminated' or exists(
        select 1 from employment_exits x where x.employee_id=e.id and x.tenant_id=v_tenant
          and x.status='confirmed' and (x.final_pay_period_id=p_period or x.last_working_day between v_start and v_end)
      ))
  ), daily as (
    select ee.employee_id,ee.days_per_week,
      (ee.employment_start + make_interval(years => extract(year from age(g.day::date,ee.employment_start))::integer))::date cycle_start
    from eligible_employees ee
    cross join lateral generate_series(greatest(v_start,ee.employment_start),ee.employment_end,interval '1 day') g(day)
  ), eligible as (
    select employee_id,round(sum(days_per_week*4 /
      (((cycle_start+interval '1 year')::date-cycle_start)::numeric)),4) days
    from daily group by employee_id
  ), ins as (
    insert into leave_accruals(tenant_id,employee_id,pay_period_id,days_accrued)
    select v_tenant,employee_id,p_period,days from eligible where days>0
    on conflict(employee_id,pay_period_id) do nothing
    returning employee_id,days_accrued
  )
  insert into leave_balances(tenant_id,employee_id,annual_days)
  select v_tenant,employee_id,days_accrued from ins
  on conflict(employee_id) do update set annual_days=leave_balances.annual_days+excluded.annual_days,updated_at=now();

  update pay_periods set status='locked',locked_at=now(),locked_by=(select auth.uid())
  where id=p_period and tenant_id=v_tenant;
end $$;

-- ── 8. Grants ───────────────────────────────────────────────────────────────
-- The rate RPCs are called by the payroll screen, so authenticated users may execute them;
-- the role check inside each one is the real gate. replace_draft_payroll stays server-only
-- (see 20260818232852_restrict_payroll_write_to_server.sql) — restated here because this
-- migration recreates the function, which resets its grants.
revoke all on function public.seed_sunday_boundary_mode() from public, anon, authenticated;
revoke all on function public.set_sunday_base_rate(uuid, numeric, numeric, text) from public, anon;
revoke all on function public.clear_sunday_base_rate(uuid) from public, anon;
revoke all on function public.acknowledge_sunday_rate_variance(uuid, text) from public, anon;
grant execute on function public.set_sunday_base_rate(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.clear_sunday_base_rate(uuid) to authenticated;
grant execute on function public.acknowledge_sunday_rate_variance(uuid, text) to authenticated;

revoke all on function public.replace_draft_payroll(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_draft_payroll(uuid, jsonb) to service_role;

revoke all on function public.finalize_payroll_period(uuid) from public, anon;
grant execute on function public.finalize_payroll_period(uuid) to authenticated;
