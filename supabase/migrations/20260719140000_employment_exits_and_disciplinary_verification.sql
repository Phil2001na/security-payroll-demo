-- Employment exits (tracker #4 dismissal, #5 resignation) and the three-person chain on
-- disciplinary actions (#12). Both share the same record → verify → confirm pipeline, with
-- a hard rule that one person can never fill two of the three roles.
--
-- Why exits are one table rather than a dismissal feature and a resignation feature: they
-- are the same event (employment ends) with different triggers, and both have to capture a
-- reason, a last working day, an approval chain and a final-pay hand-off.

create type public.employment_exit_type as enum
  ('dismissal', 'resignation', 'end_of_contract', 'abscondment');

create type public.approval_status as enum ('recorded', 'verified', 'confirmed', 'cancelled');

create table public.employment_exits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  employee_id uuid not null references public.employees(id),
  exit_type public.employment_exit_type not null,
  reason text not null,
  notice_date date,
  last_working_day date,
  status public.approval_status not null default 'recorded',
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  verified_by uuid,
  verified_at timestamptz,
  confirmed_by uuid,
  confirmed_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  final_pay_period_id uuid references public.pay_periods(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A reason is the whole point of the workflow.
  constraint employment_exits_reason_not_blank check (length(btrim(reason)) > 0),
  -- Separation of duties: no one signs off on their own paperwork.
  constraint employment_exits_verifier_distinct check (verified_by is null or verified_by <> recorded_by),
  constraint employment_exits_confirmer_distinct check (
    confirmed_by is null or (confirmed_by <> recorded_by and (verified_by is null or confirmed_by <> verified_by))
  )
);

create index employment_exits_employee_idx on public.employment_exits (employee_id, recorded_at desc);
create index employment_exits_tenant_status_idx on public.employment_exits (tenant_id, status);
-- At most one exit in flight per employee; confirmed/cancelled ones don't block a new record.
create unique index employment_exits_one_open_per_employee
  on public.employment_exits (employee_id) where status in ('recorded', 'verified');

alter table public.employment_exits enable row level security;

create policy employment_exits_select on public.employment_exits
  for select to authenticated using (tenant_id = get_my_tenant_id());

create policy employment_exits_insert on public.employment_exits
  for insert to authenticated with check (tenant_id = get_my_tenant_id());

-- Field supervisors may only *recommend* a dismissal — they can't verify, confirm, or file
-- a resignation on a guard's behalf. Everything else is management.
create policy employment_exits_role_insert on public.employment_exits
  as restrictive for insert to authenticated
  with check (
    get_my_role() = any (array['admin', 'operations', 'supervisor', 'payroll'])
    or (
      get_my_role() = 'security_supervisor'
      and exit_type = 'dismissal'
      and status = 'recorded'
      and verified_by is null
      and confirmed_by is null
    )
  );

-- Status transitions go through the RPCs below (security definer), so no direct UPDATE.
create policy employment_exits_role_update on public.employment_exits
  as restrictive for update to authenticated
  using (get_my_role() = any (array['admin', 'operations', 'payroll']));

create policy employment_exits_update on public.employment_exits
  for update to authenticated using (tenant_id = get_my_tenant_id());

create trigger employment_exits_set_updated_at
  before update on public.employment_exits
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Disciplinary actions: same chain. Rows filed before today were created under the
-- single-step regime, so they're backfilled as 'confirmed' — otherwise payroll would
-- silently stop deducting existing fines.
-- ---------------------------------------------------------------------------
alter table public.disciplinary_actions
  add column if not exists status public.approval_status not null default 'recorded',
  add column if not exists verified_by uuid,
  add column if not exists verified_at timestamptz,
  add column if not exists confirmed_by uuid,
  add column if not exists confirmed_at timestamptz;

update public.disciplinary_actions set status = 'confirmed' where status = 'recorded';

alter table public.disciplinary_actions
  add constraint disciplinary_actions_verifier_distinct
    check (verified_by is null or created_by is null or verified_by <> created_by),
  add constraint disciplinary_actions_confirmer_distinct
    check (
      confirmed_by is null
      or ((created_by is null or confirmed_by <> created_by) and (verified_by is null or confirmed_by <> verified_by))
    );

-- ---------------------------------------------------------------------------
-- Transition RPCs. All security definer: they enforce role + distinct-person rules that
-- RLS alone can't express (RLS can't see who the previous signatory was at check time in
-- a way the client can't lie about).
-- ---------------------------------------------------------------------------

create or replace function public.verify_employment_exit(p_exit uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.employment_exits;
begin
  if get_my_role() not in ('admin', 'operations', 'payroll') then
    raise exception 'Only admin, operations or payroll can verify an exit';
  end if;
  select * into v_row from public.employment_exits where id = p_exit and tenant_id = get_my_tenant_id();
  if not found then raise exception 'Exit not found'; end if;
  if v_row.status <> 'recorded' then raise exception 'Exit is already %', v_row.status; end if;
  if v_row.recorded_by = auth.uid() then
    raise exception 'The person who recorded an exit cannot verify it';
  end if;
  update public.employment_exits
     set status = 'verified', verified_by = auth.uid(), verified_at = now()
   where id = p_exit;
end $$;

create or replace function public.confirm_employment_exit(p_exit uuid, p_final_period uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.employment_exits;
begin
  if get_my_role() not in ('admin', 'operations') then
    raise exception 'Only admin or operations can confirm an exit';
  end if;
  select * into v_row from public.employment_exits where id = p_exit and tenant_id = get_my_tenant_id();
  if not found then raise exception 'Exit not found'; end if;
  if v_row.status = 'confirmed' then raise exception 'Exit is already confirmed'; end if;
  if v_row.status = 'cancelled' then raise exception 'Exit was cancelled'; end if;

  -- Dismissals and abscondments must be verified by a second person first; a resignation
  -- or contract end only needs someone other than the recorder to confirm it.
  if v_row.exit_type in ('dismissal', 'abscondment') and v_row.status <> 'verified' then
    raise exception 'A % must be verified by a second person before it can be confirmed', v_row.exit_type;
  end if;
  if auth.uid() in (v_row.recorded_by, coalesce(v_row.verified_by, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'Confirming requires a different person to the one who recorded or verified this exit';
  end if;

  update public.employment_exits
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
         final_pay_period_id = coalesce(p_final_period, final_pay_period_id)
   where id = p_exit;

  update public.employees set status = 'terminated' where id = v_row.employee_id;
end $$;

create or replace function public.cancel_employment_exit(p_exit uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.employment_exits;
begin
  if get_my_role() not in ('admin', 'operations') then
    raise exception 'Only admin or operations can cancel an exit';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A cancellation reason is required'; end if;
  select * into v_row from public.employment_exits where id = p_exit and tenant_id = get_my_tenant_id();
  if not found then raise exception 'Exit not found'; end if;
  if v_row.status = 'confirmed' then
    raise exception 'A confirmed exit cannot be cancelled — reinstate the employee instead';
  end if;
  update public.employment_exits
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_reason
   where id = p_exit;
end $$;

create or replace function public.verify_disciplinary_action(p_action uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.disciplinary_actions;
begin
  if get_my_role() not in ('admin', 'operations', 'supervisor', 'payroll') then
    raise exception 'Not permitted to verify disciplinary actions';
  end if;
  select * into v_row from public.disciplinary_actions where id = p_action and tenant_id = get_my_tenant_id();
  if not found then raise exception 'Disciplinary action not found'; end if;
  if v_row.status <> 'recorded' then raise exception 'Action is already %', v_row.status; end if;
  if v_row.created_by = auth.uid() then
    raise exception 'The person who recorded an action cannot verify it';
  end if;
  update public.disciplinary_actions
     set status = 'verified', verified_by = auth.uid(), verified_at = now()
   where id = p_action;
end $$;

create or replace function public.confirm_disciplinary_action(p_action uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.disciplinary_actions;
begin
  -- Confirmation is the step that lets a fine or unpaid suspension hit the payslip, so it
  -- sits with payroll/admin/operations.
  if get_my_role() not in ('admin', 'operations', 'payroll') then
    raise exception 'Only admin, operations or payroll can confirm a disciplinary action';
  end if;
  select * into v_row from public.disciplinary_actions where id = p_action and tenant_id = get_my_tenant_id();
  if not found then raise exception 'Disciplinary action not found'; end if;
  if v_row.status <> 'verified' then
    raise exception 'Action must be verified by a second person before it can be confirmed';
  end if;
  if auth.uid() in (coalesce(v_row.created_by, '00000000-0000-0000-0000-000000000000'::uuid), v_row.verified_by) then
    raise exception 'Confirming requires a different person to the one who recorded or verified this action';
  end if;
  update public.disciplinary_actions
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_action;
end $$;

revoke all on function public.verify_employment_exit(uuid) from public, anon;
revoke all on function public.confirm_employment_exit(uuid, uuid) from public, anon;
revoke all on function public.cancel_employment_exit(uuid, text) from public, anon;
revoke all on function public.verify_disciplinary_action(uuid) from public, anon;
revoke all on function public.confirm_disciplinary_action(uuid) from public, anon;
grant execute on function public.verify_employment_exit(uuid) to authenticated;
grant execute on function public.confirm_employment_exit(uuid, uuid) to authenticated;
grant execute on function public.cancel_employment_exit(uuid, text) to authenticated;
grant execute on function public.verify_disciplinary_action(uuid) to authenticated;
grant execute on function public.confirm_disciplinary_action(uuid) to authenticated;
