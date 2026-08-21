-- Track 2 of the wizard refresh: handle_new_user() provisioned a brand-new tenant with
-- only a tenants row, a profile, and 10 service_items catalog rows. Nothing seeded
-- payroll_constants, shift_types, or leave_policies, so:
--   * fetchPayrollConstants()/run-payroll silently fell back to hardcoded defaults for
--     every constant a fresh tenant never had a row for (the exact bug the "Verify
--     payroll constants" wizard step already warns about).
--   * A fresh tenant had zero shift_types, so /schedule couldn't assign a single shift
--     until an engineer manually inserted rows (wizard step 5's hint).
--   * A fresh tenant had zero leave_policies, so /leave had nothing to validate against
--     (wizard step 12).
-- public_holidays is intentionally NOT auto-seeded here — Namibia's calendar includes
-- movable feast dates (Good Friday/Easter Monday) that depend on the year, so a wrong
-- guess would silently misprice holiday shifts. That stays a manual/engineer step.

-- 1) Backfill existing tenants that are missing any of the canonical payroll_constants
-- keys every consumer (fetchPayrollConstants, run-payroll, enforce_monthly_hour_cap)
-- reads with a fallback default. Same NOT EXISTS guard used by the three prior
-- payroll_constants seed migrations, so this is safe to run against tenants that
-- already have some of these rows.
insert into public.payroll_constants (tenant_id, key, value, description)
select t.id, c.key, c.value, c.description
from public.tenants t
cross join (values
  ('ssc_employee_rate',         0.009,   'Employee Social Security Commission contribution rate (0.9%)'),
  ('ssc_employer_rate',         0.018,   'Employer Social Security Commission contribution rate (1.8%)'),
  ('ssc_max_deduction',         99,      'Maximum monthly SSC employee deduction (N$)'),
  ('tax_free_threshold_annual', 100000,  'Annual PAYE tax-free threshold (N$)'),
  ('min_wage_security',         16,      'Statutory minimum hourly wage for security officers (N$/hr)'),
  ('vet_levy_monthly_threshold',83333,   'Monthly payroll threshold above which the VET levy applies (N$)'),
  ('vet_levy_rate',             0.01,    'Vocational Education and Training levy rate (1%)'),
  ('night_premium_rate',        0.06,    'Night shift premium (6% of hourly rate)'),
  ('overtime_multiplier',       1.5,     'Overtime pay multiplier'),
  ('sunday_default_multiplier', 2.0,     'Sunday pay multiplier — Labour Act s.21(5) default is 2x the hourly rate'),
  ('sunday_agreed_multiplier',  1.5,     'Sunday multiplier for employees who ordinarily work Sundays under written agreement (Labour Act s.21 — 1.5x). Employees without the agreement use the 2x default.'),
  ('public_holiday_multiplier', 2.0,     'Public holiday pay multiplier — Labour Act s.21(5) default is 2x the hourly rate'),
  ('weekly_ordinary_cap',       60,      'Weekly ordinary (non-overtime) hours cap before overtime applies'),
  ('periods_per_year',          12,      'Pay periods per year, used to annualize PAYE'),
  ('monthly_hour_cap',          240,     'Maximum total hours per guard per calendar month'),
  ('monthly_overtime_cap',      20,      'Maximum overtime hours per guard per calendar month'),
  ('monthly_cap_enforced',      0,       '1 = database rejects writes past the monthly hour cap; 0 = warn only')
) as c(key, value, description)
where not exists (
  select 1 from public.payroll_constants pc where pc.tenant_id = t.id and pc.key = c.key
);

-- 2) Backfill existing tenants missing the operational (non-leave) shift types. No prior
-- migration ever seeded these tenant-wide — they were only ever created ad hoc through
-- the /schedule UI for whichever tenant an operator happened to set up by hand.
insert into public.shift_types
  (tenant_id, code, label, day_of_week, period, default_hours, pay_rule, rate_multiplier, is_premium, is_leave, active, start_min, end_min)
select t.id, c.code, c.label, c.day_of_week::public.day_of_week, c.period::public.shift_period, c.default_hours,
       c.pay_rule::public.pay_rule, c.rate_multiplier, c.is_premium, false, true, c.start_min, c.end_min
from public.tenants t
cross join (values
  ('DAY',    'Day Shift',        'any', 'day',      12::numeric, 'standard',                  1.0::numeric, false, 420::smallint, 1140::smallint),
  ('DAY6',   'Half Day Shift',   'any', 'day',      6::numeric,  'standard',                  1.0::numeric, false, 420::smallint, 780::smallint),
  ('NIGHT',  'Night Shift',      'any', 'night',    12::numeric, 'standard',                  1.0::numeric, true,  1140::smallint, 420::smallint),
  ('NIGHT6', 'Half Night Shift', 'any', 'night',    6::numeric,  'standard',                  1.0::numeric, false, 1140::smallint, 60::smallint),
  ('PH',     'Public Holiday',   'any', 'full_day', 12::numeric, 'public_holiday_ordinary',   2.0::numeric, true,  420::smallint, 1140::smallint),
  ('SUN',    'Sunday Shift',     'sun', 'full_day', 12::numeric, 'sunday_default',             1.5::numeric, true,  420::smallint, 1140::smallint)
) as c(code, label, day_of_week, period, default_hours, pay_rule, rate_multiplier, is_premium, start_min, end_min)
where not exists (
  select 1 from public.shift_types st where st.tenant_id = t.id and st.code = c.code
);

-- 3) handle_new_user(): extend the self-signup branch to seed the same defaults for
-- every brand-new tenant going forward, so a fresh signup lands with a schedulable,
-- payable tenant instead of one that silently relies on code-level fallback constants
-- and has no shift types or leave policies to work with. The invited-user branch is
-- untouched — invited accounts attach to an existing (already-provisioned) tenant.
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

  insert into public.payroll_constants (tenant_id, key, value, description)
  values
    (new_tenant_id, 'ssc_employee_rate',          0.009,  'Employee Social Security Commission contribution rate (0.9%)'),
    (new_tenant_id, 'ssc_employer_rate',          0.018,  'Employer Social Security Commission contribution rate (1.8%)'),
    (new_tenant_id, 'ssc_max_deduction',          99,     'Maximum monthly SSC employee deduction (N$)'),
    (new_tenant_id, 'tax_free_threshold_annual',  100000, 'Annual PAYE tax-free threshold (N$)'),
    (new_tenant_id, 'min_wage_security',          16,     'Statutory minimum hourly wage for security officers (N$/hr)'),
    (new_tenant_id, 'vet_levy_monthly_threshold', 83333,  'Monthly payroll threshold above which the VET levy applies (N$)'),
    (new_tenant_id, 'vet_levy_rate',              0.01,   'Vocational Education and Training levy rate (1%)'),
    (new_tenant_id, 'night_premium_rate',         0.06,   'Night shift premium (6% of hourly rate)'),
    (new_tenant_id, 'overtime_multiplier',        1.5,    'Overtime pay multiplier'),
    (new_tenant_id, 'sunday_default_multiplier',  2.0,    'Sunday pay multiplier — Labour Act s.21(5) default is 2x the hourly rate'),
    (new_tenant_id, 'sunday_agreed_multiplier',   1.5,    'Sunday multiplier for employees who ordinarily work Sundays under written agreement (Labour Act s.21 — 1.5x). Employees without the agreement use the 2x default.'),
    (new_tenant_id, 'public_holiday_multiplier',  2.0,    'Public holiday pay multiplier — Labour Act s.21(5) default is 2x the hourly rate'),
    (new_tenant_id, 'weekly_ordinary_cap',        60,     'Weekly ordinary (non-overtime) hours cap before overtime applies'),
    (new_tenant_id, 'periods_per_year',           12,     'Pay periods per year, used to annualize PAYE'),
    (new_tenant_id, 'monthly_hour_cap',           240,    'Maximum total hours per guard per calendar month'),
    (new_tenant_id, 'monthly_overtime_cap',       20,     'Maximum overtime hours per guard per calendar month'),
    (new_tenant_id, 'monthly_cap_enforced',       0,      '1 = database rejects writes past the monthly hour cap; 0 = warn only');

  insert into public.shift_types
    (tenant_id, code, label, day_of_week, period, default_hours, pay_rule, rate_multiplier, is_premium, is_leave, active, start_min, end_min)
  values
    (new_tenant_id, 'DAY',    'Day Shift',        'any', 'day',      12, 'standard',                '1.0', false, false, true, 420,  1140),
    (new_tenant_id, 'DAY6',   'Half Day Shift',   'any', 'day',      6,  'standard',                '1.0', false, false, true, 420,  780),
    (new_tenant_id, 'NIGHT',  'Night Shift',      'any', 'night',    12, 'standard',                '1.0', true,  false, true, 1140, 420),
    (new_tenant_id, 'NIGHT6', 'Half Night Shift', 'any', 'night',    6,  'standard',                '1.0', false, false, true, 1140, 60),
    (new_tenant_id, 'PH',     'Public Holiday',   'any', 'full_day', 12, 'public_holiday_ordinary', '2.0', true,  false, true, 420,  1140),
    (new_tenant_id, 'SUN',    'Sunday Shift',     'sun', 'full_day', 12, 'sunday_default',           '1.5', true,  false, true, 420,  1140),
    (new_tenant_id, 'LEAVE-ANNUAL',       'Annual leave',       'any', 'full_day', 12, 'leave', '1.0', false, true, true, null, null),
    (new_tenant_id, 'LEAVE-SICK',         'Sick leave',         'any', 'full_day', 12, 'leave', '1.0', false, true, true, null, null),
    (new_tenant_id, 'LEAVE-COMPASSIONATE','Compassionate leave','any', 'full_day', 12, 'leave', '1.0', false, true, true, null, null),
    (new_tenant_id, 'LEAVE-MATERNITY',    'Maternity leave',    'any', 'full_day', 12, 'off',   '0.0', false, true, true, null, null),
    (new_tenant_id, 'LEAVE-UNPAID',       'Unpaid leave',       'any', 'full_day', 12, 'off',   '0.0', false, true, true, null, null);

  insert into public.leave_policies
    (tenant_id, leave_type, label, paid_percent, balance_enforced, allow_negative, evidence_required_after_days)
  values
    (new_tenant_id, 'annual',       'Annual leave',       100, true,  false, null),
    (new_tenant_id, 'sick',         'Sick leave',          100, true,  false, 3),
    (new_tenant_id, 'compassionate','Compassionate leave', 100, true,  false, null),
    (new_tenant_id, 'maternity',    'Maternity leave',     0,   false, false, null),
    (new_tenant_id, 'unpaid',       'Unpaid leave',        0,   false, false, null);

  return new;
end;
$function$;
