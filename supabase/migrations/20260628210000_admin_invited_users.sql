-- Admin-created users: route invited accounts into the inviter's existing tenant
-- instead of provisioning a brand-new company. When auth metadata carries an
-- `invited_tenant_id`, we attach the new profile to that tenant with the chosen
-- role; otherwise we keep the original self-signup behaviour (new tenant + admin).
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_tenant_id  uuid;
  company_name   text;
  invited_tenant uuid;
  invited_role   text;
BEGIN
  -- Admin-invited user: attach to the existing tenant, do NOT create a company.
  invited_tenant := NULLIF(trim(NEW.raw_user_meta_data->>'invited_tenant_id'), '')::uuid;
  IF invited_tenant IS NOT NULL THEN
    invited_role := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'invited_role'), ''), 'viewer');
    INSERT INTO public.profiles (id, tenant_id, full_name, email, role, is_active)
    VALUES (
      NEW.id,
      invited_tenant,
      COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1)),
      NEW.email,
      invited_role::app_role,
      true
    );
    RETURN NEW;
  END IF;

  -- Self-signup (no invite): provision a brand-new tenant and make the user its admin.
  company_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'company_name'), ''),
    initcap(replace(split_part(split_part(NEW.email, '@', 2), '.', 1), '-', ' ')) || ' Security'
  );

  INSERT INTO public.tenants (name, company_email)
  VALUES (company_name, NEW.email)
  RETURNING id INTO new_tenant_id;

  INSERT INTO public.profiles (id, tenant_id, full_name, email, role, is_active)
  VALUES (
    NEW.id,
    new_tenant_id,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1)),
    NEW.email,
    'admin',
    true
  );

  -- Seed the standard security service catalog for this tenant
  INSERT INTO public.service_items (tenant_id, name, description, unit, default_rate)
  VALUES
    (new_tenant_id, 'Guarding — Day shift',        'Unarmed security officer, 06h00–18h00', 'hour',    35.00),
    (new_tenant_id, 'Guarding — Night shift',      'Unarmed security officer, 18h00–06h00', 'hour',    40.00),
    (new_tenant_id, 'Armed guarding',              'Armed security officer',                 'hour',    55.00),
    (new_tenant_id, 'Site supervisor',             'On-site supervisor',                     'hour',    45.00),
    (new_tenant_id, 'Armed response callout',      'Armed response unit dispatched to site', 'callout', 250.00),
    (new_tenant_id, 'Alarm monitoring',            '24/7 alarm monitoring service',          'month',   450.00),
    (new_tenant_id, 'CCTV monitoring',             'Off-site CCTV monitoring',               'month',   850.00),
    (new_tenant_id, 'K9 patrol unit',              'Handler and patrol dog per shift',       'shift',   650.00),
    (new_tenant_id, 'Event security',              'Security officer per event deployment',  'event',   500.00),
    (new_tenant_id, 'Cash-in-transit escort',      'Escort per trip',                        'trip',    400.00);

  RETURN NEW;
END;
$function$;
