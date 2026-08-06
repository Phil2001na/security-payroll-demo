-- Close privilege self-escalation via profiles self-update.
--
-- profiles_update_own allows a user to UPDATE their own row with no column
-- restrictions — so any authenticated user could set role='admin' or
-- is_ceo_executive=true directly via PostgREST, making every role check moot.
--
-- The role-onboarding dialog legitimately sets role/is_ceo_executive on first
-- run, so: privileged columns (role, is_ceo_executive, is_active, tenant_id)
-- may only be self-changed while onboarding_complete is still false. After
-- onboarding, only the SECURITY DEFINER admin paths (set_user_role, service
-- role) can change them.
--
-- NOTE for handover: the first-run role picker itself still lets a new user
-- choose admin — acceptable for the demo, remove before a real client tenant.

create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  -- service role / postgres (no JWT) and admin users may change anything
  if auth.uid() is null or public.get_my_role() = 'admin' then
    return new;
  end if;

  if (new.role is distinct from old.role
      or new.is_ceo_executive is distinct from old.is_ceo_executive
      or new.is_active is distinct from old.is_active
      or new.tenant_id is distinct from old.tenant_id) then
    -- first-run onboarding pick is allowed once
    if old.onboarding_complete then
      raise exception 'Not allowed to change role or account status';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileged on public.profiles;
create trigger trg_guard_profile_privileged
  before update on public.profiles
  for each row
  execute function public.guard_profile_privileged_columns();
