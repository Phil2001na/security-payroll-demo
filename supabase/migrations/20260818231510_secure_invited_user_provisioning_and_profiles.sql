-- Security hardening: auth.user_metadata is editable by the end user, so it
-- must never decide a profile's tenant or role. Invited accounts created by
-- the admin edge function instead carry those values in app_metadata, which
-- only the Auth admin API can set.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_tenant_id uuid;
  company_name text;
  invited_tenant uuid;
  invited_role text;
  invited_tenant_text text;
begin
  -- Never use raw_user_meta_data for authorization: Auth clients can set it
  -- during sign-up. app_metadata is written only by the trusted Admin API.
  invited_tenant_text := nullif(trim(new.raw_app_meta_data->>'invited_tenant_id'), '');
  if invited_tenant_text is not null
     and invited_tenant_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    invited_tenant := invited_tenant_text::uuid;
    invited_role := coalesce(nullif(trim(new.raw_app_meta_data->>'invited_role'), ''), 'viewer');

    insert into public.profiles (id, tenant_id, full_name, email, role, is_active)
    values (
      new.id,
      invited_tenant,
      coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      invited_role::public.app_role,
      true
    );
    return new;
  end if;

  -- An ordinary self-signup can only create its own new tenant. Client
  -- metadata cannot attach it to an existing tenant or grant it a role there.
  company_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'company_name'), ''),
    initcap(replace(split_part(split_part(new.email, '@', 2), '.', 1), '-', ' ')) || ' Security'
  );

  insert into public.tenants (name, company_email)
  values (company_name, new.email)
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, full_name, email, role, is_active)
  values (
    new.id,
    new_tenant_id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    'admin',
    true
  );

  insert into public.service_items (tenant_id, name, description, unit, default_rate)
  values
    (new_tenant_id, 'Guarding - Day shift', 'Unarmed security officer, 06h00-18h00', 'hour', 35.00),
    (new_tenant_id, 'Guarding - Night shift', 'Unarmed security officer, 18h00-06h00', 'hour', 40.00),
    (new_tenant_id, 'Armed guarding', 'Armed security officer', 'hour', 55.00),
    (new_tenant_id, 'Site supervisor', 'On-site supervisor', 'hour', 45.00),
    (new_tenant_id, 'Armed response callout', 'Armed response unit dispatched to site', 'callout', 250.00),
    (new_tenant_id, 'Alarm monitoring', '24/7 alarm monitoring service', 'month', 450.00),
    (new_tenant_id, 'CCTV monitoring', 'Off-site CCTV monitoring service', 'month', 850.00),
    (new_tenant_id, 'K9 patrol unit', 'Handler and patrol dog per shift', 'shift', 650.00),
    (new_tenant_id, 'Event security', 'Security officer per event deployment', 'event', 500.00),
    (new_tenant_id, 'Cash-in-transit escort', 'Escort per trip', 'trip', 400.00);

  return new;
end;
$function$;

-- Direct PostgREST updates run as `authenticated`. Privileged database
-- functions (set_user_role and the Auth trigger) run as their definer and
-- retain their existing authorization checks. This makes the restriction
-- column-level without weakening those audited server-side paths.
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_ceo_executive is distinct from old.is_ceo_executive
     or new.is_active is distinct from old.is_active
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'Not allowed to change role, tenant, or account status';
  end if;

  if old.onboarding_complete and not new.onboarding_complete then
    raise exception 'Onboarding cannot be reopened';
  end if;

  return new;
end;
$function$;
