-- Security Supervisor role: a new attendance-only role. Security supervisors mark
-- attendance for their assigned sites; payroll approves before it counts toward pay.
--
-- NOTE: the live DB (nakvdkkezgdqxytygtqp) enforces RBAC in the frontend and uses
-- tenant-only RLS (get_my_tenant_id). Site-scoping, replace-guard restriction, and
-- the submit->approve gate are implemented in the frontend. The only DB changes
-- needed are the new enum values and SECURITY DEFINER RPCs (because public.profiles
-- only permits update_own, so cross-user profile writes require a definer function).

-- 1) New enum values (each ADD VALUE must commit before being used).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'security_supervisor';
ALTER TYPE public.shift_log_status ADD VALUE IF NOT EXISTS 'submitted';

-- 2) Assign sites to a supervisor (admin/operations/payroll). Target must be a
--    supervisor role. Lets payroll manage supervisor coverage without broad
--    profiles write access.
create or replace function public.set_user_sites(p_user uuid, p_site_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid;
  v_caller_role text;
  v_target_role text;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then
    raise exception 'No tenant context';
  end if;

  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role not in ('admin','operations','payroll') then
    raise exception 'Not authorized to assign sites';
  end if;

  select role::text into v_target_role
  from public.profiles
  where id = p_user and tenant_id = v_tenant;

  if v_target_role is null then
    raise exception 'Target user not found in your tenant';
  end if;
  if v_target_role not in ('supervisor','security_supervisor') then
    raise exception 'Sites can only be assigned to supervisor roles';
  end if;

  update public.profiles
    set assigned_site_ids = coalesce(p_site_ids, '{}')
    where id = p_user and tenant_id = v_tenant;
end;
$$;

-- 3) Change a user's role (admin only). Required so an admin can create a
--    security_supervisor via the UI (direct profiles update is RLS-blocked).
create or replace function public.set_user_role(p_user uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid;
  v_caller_role text;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then
    raise exception 'No tenant context';
  end if;

  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role <> 'admin' then
    raise exception 'Only admins can change user roles';
  end if;

  if p_user = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;

  update public.profiles
    set role = p_role
    where id = p_user and tenant_id = v_tenant;
end;
$$;

grant execute on function public.set_user_sites(uuid, uuid[]) to authenticated;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;

-- 4) Allow listing profiles within your own tenant. Live previously only had
--    select_own, which made the System Users / Supervisors lists return only the
--    caller. Same-tenant visibility only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles' and policyname='profiles_select_tenant'
  ) then
    create policy "profiles_select_tenant" on public.profiles
      for select using (tenant_id = public.get_my_tenant_id());
  end if;
end $$;
