-- UAT-09 — senior-authorised emergency exceptions to the rostering safety rules.
--
-- Decision §5 of DECISIONS-2026-09-03.md: limits hard-block on every write path; an admin may
-- record an override carrying a mandatory reason and an explicit legal-risk acknowledgement,
-- raised as its own audit event and never as an ordinary roster edit.
--
-- Two design points worth stating, because neither is spelled out in the decision:
--
-- 1. Not every rule is overridable. "Rostered work must use a Day or Night shift type" and
--    "guard already has a working shift that day" are structural — overriding them produces
--    incoherent data, not an accepted legal risk. Only the rules that represent a labour-law
--    exposure someone can knowingly accept can be overridden, plus the monthly hour cap
--    (UAT-05 builds on this).
--
-- 2. An override is SINGLE USE, tied to one employee on one date. A reusable override would
--    quietly become a permanent exemption, which is exactly the "warning-only bypass" UAT-05
--    forbids. It is consumed by the assignment that relies on it.
--
-- The record -> verify -> confirm chain from src/lib/approvals.ts is reused, but the override
-- is EFFECTIVE AS SOON AS IT IS RECORDED — it is an emergency path, and requiring a second
-- person before the roster can be written would defeat its purpose. Verification and
-- confirmation are the post-hoc review, and they carry approvals.ts's rule that one person
-- cannot fill two of the roles.

create table public.roster_emergency_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  override_date date not null,
  site_id uuid references public.sites(id) on delete set null,

  -- The specific rules this override authorises. Named, not a blanket "ignore safety".
  rules text[] not null
    check (cardinality(rules) > 0)
    check (rules <@ array['weekly_hours','weekly_rest','night_to_day','day_to_night','monthly_hours']::text[]),

  -- Mandatory and substantive. A one-word reason is not an audit trail.
  reason text not null check (length(btrim(reason)) >= 20),
  -- Mandatory and must be true; the column exists to make the acknowledgement a stored fact.
  legal_risk_acknowledged boolean not null check (legal_risk_acknowledged),

  status public.approval_status not null default 'recorded',
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  cancelled_reason text,

  -- DEFERRABLE INITIALLY DEFERRED because consumption happens inside a BEFORE INSERT trigger
  -- on schedule_assignments: the assignment row does not exist yet at that moment, so an
  -- immediate FK check would fail on every legitimate override. Checked at commit instead.
  consumed_assignment_id uuid references public.schedule_assignments(id) on delete set null
    deferrable initially deferred,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),

  -- Mirrors the disciplinary/exit chain: nobody verifies or confirms their own record.
  constraint roster_override_verifier_differs
    check (verified_by is null or verified_by <> recorded_by),
  constraint roster_override_confirmer_differs
    check (confirmed_by is null or (confirmed_by <> recorded_by and confirmed_by is distinct from verified_by))
);

create index roster_emergency_overrides_lookup_idx
  on public.roster_emergency_overrides (tenant_id, employee_id, override_date)
  where consumed_at is null and status <> 'cancelled';

alter table public.roster_emergency_overrides enable row level security;

-- Visible to everyone who can see the roster it affects; this is accountability data, so a
-- supervisor should be able to see that an override was used on their site.
create policy roster_emergency_overrides_read on public.roster_emergency_overrides
  for select to authenticated using (
    tenant_id = (select public.get_my_tenant_id())
    and (select public.get_my_role()) in ('admin','operations','supervisor','payroll','security_supervisor')
  );

-- Supabase's default privileges hand `authenticated` and `anon` full rights on every new
-- table in this schema, TRUNCATE included — and TRUNCATE is not subject to RLS. Every write
-- here must go through the RPCs below so the reason and the acknowledgement cannot be
-- bypassed, so the inherited grants are stripped first and only SELECT is handed back.
revoke all on public.roster_emergency_overrides from authenticated, anon;
grant select on public.roster_emergency_overrides to authenticated;

-- Its own audit event, distinct from any schedule_assignments row the override enables.
create trigger trg_audit_roster_emergency_overrides
  after insert or update or delete on public.roster_emergency_overrides
  for each row execute function public.write_audit_event();

-- ---------------------------------------------------------------------------------------
-- Recording an override. Admin only, by decision §5.
-- ---------------------------------------------------------------------------------------
create or replace function public.record_roster_override(
  p_employee uuid,
  p_date date,
  p_rules text[],
  p_reason text,
  p_acknowledge_legal_risk boolean,
  p_site uuid default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := get_my_tenant_id();
  v_role text := get_my_role();
  v_id uuid;
begin
  if (select auth.uid()) is null or v_role <> 'admin' then
    raise exception 'Only an admin can authorise an emergency rostering override';
  end if;
  if not coalesce(p_acknowledge_legal_risk, false) then
    raise exception 'The legal-risk acknowledgement is required';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 20 then
    raise exception 'A reason of at least 20 characters is required';
  end if;
  if coalesce(cardinality(p_rules), 0) = 0 then
    raise exception 'Name at least one rule this override authorises';
  end if;
  if not exists (select 1 from employees e where e.id = p_employee and e.tenant_id = v_tenant) then
    raise exception 'Employee not found';
  end if;

  insert into roster_emergency_overrides (
    tenant_id, employee_id, override_date, site_id, rules, reason,
    legal_risk_acknowledged, recorded_by
  ) values (
    v_tenant, p_employee, p_date, p_site, p_rules, btrim(p_reason),
    true, (select auth.uid())
  ) returning id into v_id;

  return v_id;
end $fn$;

grant execute on function public.record_roster_override(uuid, date, text[], text, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Post-hoc review. Same two-role rule as disciplinary actions and employment exits.
-- ---------------------------------------------------------------------------------------
create or replace function public.verify_roster_override(p_override uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := get_my_tenant_id();
  v_role text := get_my_role();
  v_row roster_emergency_overrides;
begin
  if (select auth.uid()) is null or v_role not in ('admin','operations','payroll') then
    raise exception 'Not permitted to verify a rostering override';
  end if;
  select * into v_row from roster_emergency_overrides where id = p_override and tenant_id = v_tenant for update;
  if not found then raise exception 'Override not found'; end if;
  if v_row.status <> 'recorded' then raise exception 'Override is already %', v_row.status; end if;
  if v_row.recorded_by = (select auth.uid()) then
    raise exception 'The person who authorised the override cannot verify it';
  end if;
  update roster_emergency_overrides
     set status = 'verified', verified_by = (select auth.uid()), verified_at = now()
   where id = p_override;
end $fn$;

create or replace function public.confirm_roster_override(p_override uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := get_my_tenant_id();
  v_role text := get_my_role();
  v_row roster_emergency_overrides;
begin
  if (select auth.uid()) is null or v_role not in ('admin','operations') then
    raise exception 'Not permitted to confirm a rostering override';
  end if;
  select * into v_row from roster_emergency_overrides where id = p_override and tenant_id = v_tenant for update;
  if not found then raise exception 'Override not found'; end if;
  if v_row.status <> 'verified' then raise exception 'Override must be verified before it is confirmed'; end if;
  if v_row.recorded_by = (select auth.uid()) or v_row.verified_by = (select auth.uid()) then
    raise exception 'A third person must confirm the override';
  end if;
  update roster_emergency_overrides
     set status = 'confirmed', confirmed_by = (select auth.uid()), confirmed_at = now()
   where id = p_override;
end $fn$;

create or replace function public.cancel_roster_override(p_override uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := get_my_tenant_id();
  v_role text := get_my_role();
  v_row roster_emergency_overrides;
begin
  if (select auth.uid()) is null or v_role not in ('admin','operations') then
    raise exception 'Not permitted to cancel a rostering override';
  end if;
  if length(btrim(coalesce(p_reason,''))) = 0 then raise exception 'A reason is required'; end if;
  select * into v_row from roster_emergency_overrides where id = p_override and tenant_id = v_tenant for update;
  if not found then raise exception 'Override not found'; end if;
  if v_row.consumed_at is not null then
    raise exception 'This override has already been used by a roster assignment and cannot be cancelled';
  end if;
  update roster_emergency_overrides
     set status = 'cancelled', cancelled_reason = btrim(p_reason)
   where id = p_override;
end $fn$;

grant execute on function public.verify_roster_override(uuid) to authenticated;
grant execute on function public.confirm_roster_override(uuid) to authenticated;
grant execute on function public.cancel_roster_override(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Consumption. Called from the enforcement triggers, never by the app.
-- ---------------------------------------------------------------------------------------
create or replace function public.consume_roster_override(
  p_tenant uuid, p_employee uuid, p_date date, p_rules text[], p_assignment uuid
) returns boolean language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  -- An assignment being UPDATED may already own its override; re-consuming must be a no-op
  -- rather than a second demand for authorisation.
  if p_assignment is not null and exists (
    select 1 from roster_emergency_overrides
     where consumed_assignment_id = p_assignment and status <> 'cancelled' and p_rules <@ rules
  ) then
    return true;
  end if;

  select id into v_id
    from roster_emergency_overrides
   where tenant_id = p_tenant
     and employee_id = p_employee
     and override_date = p_date
     and consumed_at is null
     and status <> 'cancelled'
     and p_rules <@ rules          -- must cover every rule actually breached
   order by recorded_at
   limit 1
     for update;

  if v_id is null then return false; end if;

  update roster_emergency_overrides
     set consumed_at = now(), consumed_assignment_id = p_assignment
   where id = v_id;
  return true;
end $fn$;

revoke all on function public.consume_roster_override(uuid, uuid, date, text[], uuid) from authenticated, anon;

-- ---------------------------------------------------------------------------------------
-- The integrity trigger, rewritten to collect every breach then consult the override once.
-- Collecting first means the refusal message names ALL the failed rules, which is what UAT-08
-- asks for, and means one override can authorise a genuinely multi-rule emergency.
-- ---------------------------------------------------------------------------------------
create or replace function public.enforce_roster_assignment_integrity()
returns trigger language plpgsql set search_path = public as $fn$
declare
  v_is_work boolean;
  v_kind text;
  v_week_hours numeric;
  v_worked_days integer;
  -- Each append is cast to ::text explicitly. Without it plpgsql reads the bare literal as
  -- an array literal and fails with "malformed array literal" the moment a rule is breached.
  v_breaches text[] := '{}';
  v_detail text[] := '{}';
begin
  select not st.is_leave and st.default_hours > 0,
         case
           when st.period = 'night' then 'night'
           when st.period in ('day', 'full_day', 'morning') then 'day'
           else null
         end
    into v_is_work, v_kind
    from public.shift_types st
   where st.id = new.shift_type_id;

  if not coalesce(v_is_work, false) then
    return new;
  end if;

  -- Structural rules. Never overridable — breaking these produces incoherent data rather
  -- than an accepted risk, so there is nothing for an admin to knowingly accept.
  if v_kind is null then
    raise exception 'Rostered work must use a Day or Night shift type'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.schedule_assignments sa
      join public.shift_types st on st.id = sa.shift_type_id
     where sa.employee_id = new.employee_id and sa.date = new.date and sa.id <> new.id
       and not st.is_leave and st.default_hours > 0
  ) then
    raise exception 'Guard already has a working shift on %', new.date
      using errcode = 'check_violation';
  end if;

  -- Overridable rules, each a labour-law exposure someone can knowingly accept.
  select coalesce(sum(sa.planned_hours), 0) into v_week_hours
    from public.schedule_assignments sa
    join public.shift_types st on st.id = sa.shift_type_id
   where sa.employee_id = new.employee_id
     and date_trunc('week', sa.date)::date = date_trunc('week', new.date)::date
     and sa.id <> new.id and not st.is_leave and st.default_hours > 0;

  if v_week_hours + new.planned_hours > 60
     and not public.has_ps_exemption(new.employee_id, new.date) then
    v_breaches := v_breaches || 'weekly_hours'::text;
    v_detail := v_detail || format('weekly hour cap (would reach %s hours)', v_week_hours + new.planned_hours)::text;
  end if;

  select count(distinct sa.date) into v_worked_days
    from public.schedule_assignments sa
    join public.shift_types st on st.id = sa.shift_type_id
   where sa.employee_id = new.employee_id
     and date_trunc('week', sa.date)::date = date_trunc('week', new.date)::date
     and sa.id <> new.id and not st.is_leave and st.default_hours > 0;

  if v_worked_days >= 6 then
    v_breaches := v_breaches || 'weekly_rest'::text;
    v_detail := v_detail || 'weekly rest (no full day off that week)'::text;
  end if;

  if v_kind = 'day' and exists (
    select 1 from public.schedule_assignments sa
      join public.shift_types st on st.id = sa.shift_type_id
     where sa.employee_id = new.employee_id and sa.date = new.date - 1 and sa.id <> new.id
       and not st.is_leave and st.period = 'night'
  ) then
    v_breaches := v_breaches || 'night_to_day'::text;
    v_detail := v_detail || 'rest between shifts (Night shift the day before)'::text;
  end if;

  if v_kind = 'night' and exists (
    select 1 from public.schedule_assignments sa
      join public.shift_types st on st.id = sa.shift_type_id
     where sa.employee_id = new.employee_id and sa.date = new.date + 1 and sa.id <> new.id
       and not st.is_leave and st.period in ('day', 'full_day', 'morning')
  ) then
    v_breaches := v_breaches || 'day_to_night'::text;
    v_detail := v_detail || 'rest between shifts (Day shift the day after)'::text;
  end if;

  if cardinality(v_breaches) = 0 then
    return new;
  end if;

  if public.consume_roster_override(new.tenant_id, new.employee_id, new.date, v_breaches, new.id) then
    return new;
  end if;

  -- DETAIL carries the machine-readable rule keys so the client can offer an override for
  -- exactly the rules that failed, without parsing the prose message. PostgREST surfaces it
  -- to supabase-js as error.details.
  raise exception 'Assignment refused — % failed: %',
    case when cardinality(v_breaches) = 1 then 'this rule' else 'these rules' end,
    array_to_string(v_detail, '; ')
    using errcode = 'check_violation',
          detail = array_to_string(v_breaches, ','),
          hint = 'An admin can authorise an emergency override for this guard on this date.';
end $fn$;

drop trigger if exists schedule_assignments_integrity_guard on public.schedule_assignments;
create trigger schedule_assignments_integrity_guard
before insert or update of employee_id, date, shift_type_id, planned_hours
on public.schedule_assignments
for each row execute function public.enforce_roster_assignment_integrity();
