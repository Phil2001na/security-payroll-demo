-- Assign supervisors to a site from the site screen (inverse of set_user_sites).
-- Given a site and the chosen supervisor user ids, adds the site to those
-- supervisors' assigned_site_ids and removes it from the rest. Admin/ops/payroll only.
CREATE OR REPLACE FUNCTION public.set_site_supervisors(p_site uuid, p_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_caller_role text;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then
    raise exception 'No tenant context';
  end if;

  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role not in ('admin','operations','payroll') then
    raise exception 'Not authorized to assign supervisors';
  end if;

  if not exists (select 1 from public.sites where id = p_site and tenant_id = v_tenant) then
    raise exception 'Site not found in your tenant';
  end if;

  -- Add the site to selected supervisors that don't already have it.
  update public.profiles
    set assigned_site_ids =
      array(select distinct unnest(coalesce(assigned_site_ids, '{}') || array[p_site]))
    where tenant_id = v_tenant
      and role = 'security_supervisor'
      and id = any(coalesce(p_user_ids, '{}'))
      and not (p_site = any(coalesce(assigned_site_ids, '{}')));

  -- Remove the site from supervisors no longer selected.
  update public.profiles
    set assigned_site_ids = array_remove(coalesce(assigned_site_ids, '{}'), p_site)
    where tenant_id = v_tenant
      and role = 'security_supervisor'
      and not (id = any(coalesce(p_user_ids, '{}')))
      and p_site = any(coalesce(assigned_site_ids, '{}'));
end;
$function$;
