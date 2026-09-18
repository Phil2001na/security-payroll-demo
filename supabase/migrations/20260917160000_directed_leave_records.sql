-- UAT-13 — evidence that annual leave was offered or instructed, and what the employee said.
--
-- Decision §7 of DECISIONS-2026-09-03.md: typed acknowledgement plus attachments, no
-- signature-capture UI. Record who offered, the dates offered, the reason, the employee's
-- response (acknowledged / refused / refused-to-sign), an optional witness, optional file
-- attachments for a scanned paper form, the recording user and timestamp. Append-only once
-- saved. Exportable.
--
-- Why this table exists at all: Labour Act s.23 puts the obligation to GIVE annual leave on
-- the employer. When a guard reaches their deadline without having taken it, the employer's
-- defence is evidence that it was offered and declined. A leave_request that was never made
-- is not that evidence.
--
-- Attachments reuse the existing `leave-evidence` storage bucket and its
-- <tenant_id>/<employee_id>/<file> path convention, so the storage RLS already written for
-- leave request evidence applies unchanged. Paths are stored, never public URLs.

create table public.directed_leave_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,

  -- Who put the offer to the employee, and when. Distinct from recorded_by: a supervisor may
  -- make the offer on site and HR type it up afterwards.
  offered_by uuid not null references public.profiles(id),
  offered_on date not null default current_date,

  -- The dates that were actually offered.
  leave_start date not null,
  leave_end date not null,
  constraint directed_leave_dates_ordered check (leave_end >= leave_start),

  reason text not null check (length(btrim(reason)) > 0),

  response text not null check (response in ('acknowledged', 'refused', 'refused_to_sign')),
  -- The typed acknowledgement itself: the employee's name as typed, not a drawn signature.
  -- Required when they acknowledged; meaningless when they refused to sign, which is the
  -- whole point of that third option.
  typed_acknowledgement text,
  constraint directed_leave_ack_present check (
    response <> 'acknowledged' or length(btrim(coalesce(typed_acknowledgement, ''))) > 0
  ),
  response_note text,
  witness_name text,

  -- Storage paths inside the leave-evidence bucket. A scanned signed form is stronger
  -- evidence than anything drawn on screen, which is why §7 chose attachments over a pad.
  attachments text[] not null default '{}',

  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now()
);

create index directed_leave_records_tenant_employee_idx
  on public.directed_leave_records (tenant_id, employee_id, offered_on desc);

alter table public.directed_leave_records enable row level security;

create policy directed_leave_records_read on public.directed_leave_records
  for select to authenticated using (
    tenant_id = (select public.get_my_tenant_id())
    and (select public.get_my_role()) in ('admin', 'operations', 'payroll', 'supervisor')
  );

-- Supabase default privileges grant `authenticated` everything on a new table, TRUNCATE
-- included, and TRUNCATE is not subject to RLS — which would defeat append-only entirely.
revoke all on public.directed_leave_records from authenticated, anon;
grant select on public.directed_leave_records to authenticated;

-- Append-only, enforced in the database rather than by the absence of a policy. A missing
-- UPDATE policy stops PostgREST; it does not stop a SECURITY DEFINER function written later.
-- This trigger holds regardless of who is asking.
create or replace function public.prevent_directed_leave_mutation()
returns trigger language plpgsql as $fn$
begin
  raise exception
    'Directed leave records are append-only. Record a new entry instead of changing this one.'
    using errcode = 'check_violation';
end $fn$;

create trigger directed_leave_records_append_only
  before update or delete on public.directed_leave_records
  for each row execute function public.prevent_directed_leave_mutation();

create trigger trg_audit_directed_leave_records
  after insert or update or delete on public.directed_leave_records
  for each row execute function public.write_audit_event();

-- ---------------------------------------------------------------------------------------
-- Recording. Same roles that can approve leave, since this is the other half of the same
-- statutory obligation.
-- ---------------------------------------------------------------------------------------
create or replace function public.record_directed_leave(
  p_employee uuid,
  p_leave_start date,
  p_leave_end date,
  p_reason text,
  p_response text,
  p_typed_acknowledgement text default null,
  p_response_note text default null,
  p_witness_name text default null,
  p_attachments text[] default '{}',
  p_offered_by uuid default null,
  p_offered_on date default null
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := get_my_tenant_id();
  v_role text := get_my_role();
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if v_actor is null or v_role not in ('admin', 'operations', 'payroll', 'supervisor') then
    raise exception 'Not permitted to record directed leave';
  end if;
  if p_response not in ('acknowledged', 'refused', 'refused_to_sign') then
    raise exception 'Response must be acknowledged, refused or refused_to_sign';
  end if;
  if p_response = 'acknowledged'
     and length(btrim(coalesce(p_typed_acknowledgement, ''))) = 0 then
    raise exception 'A typed acknowledgement is required when the employee acknowledged the offer';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required';
  end if;
  if p_leave_end < p_leave_start then
    raise exception 'The last day offered cannot be before the first';
  end if;
  if not exists (select 1 from employees e where e.id = p_employee and e.tenant_id = v_tenant) then
    raise exception 'Employee not found';
  end if;
  -- An offer cannot have been made by someone outside this tenant.
  if p_offered_by is not null
     and not exists (select 1 from profiles pr where pr.id = p_offered_by and pr.tenant_id = v_tenant) then
    raise exception 'The person who made the offer must belong to this tenant';
  end if;

  insert into directed_leave_records (
    tenant_id, employee_id, offered_by, offered_on, leave_start, leave_end, reason,
    response, typed_acknowledgement, response_note, witness_name, attachments, recorded_by
  ) values (
    v_tenant, p_employee, coalesce(p_offered_by, v_actor), coalesce(p_offered_on, current_date),
    p_leave_start, p_leave_end, btrim(p_reason),
    p_response, nullif(btrim(coalesce(p_typed_acknowledgement, '')), ''),
    nullif(btrim(coalesce(p_response_note, '')), ''),
    nullif(btrim(coalesce(p_witness_name, '')), ''),
    coalesce(p_attachments, '{}'), v_actor
  ) returning id into v_id;

  return v_id;
end $fn$;

grant execute on function public.record_directed_leave(
  uuid, date, date, text, text, text, text, text, text[], uuid, date
) to authenticated;
