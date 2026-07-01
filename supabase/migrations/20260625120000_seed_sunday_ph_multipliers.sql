-- Make the Sunday and Public Holiday pay multipliers editable in Admin → Settings.
--
-- The payroll engine reads `sunday_default_multiplier` and `public_holiday_multiplier`
-- from payroll_constants, but no rows existed — so it silently used the hardcoded 2×
-- fallback and there was nothing to edit. Seed both for every tenant at the Labour Act
-- s.21(5) default of 2×; they then surface in the existing "Payroll constants" editor.
INSERT INTO public.payroll_constants (tenant_id, key, value, description)
SELECT t.id, v.key, v.value, v.description
  FROM public.tenants t
  CROSS JOIN (VALUES
    ('sunday_default_multiplier', 2.0, 'Sunday pay multiplier — Labour Act s.21(5) default is 2x the hourly rate'),
    ('public_holiday_multiplier', 2.0, 'Public holiday pay multiplier — Labour Act s.21(5) default is 2x the hourly rate')
  ) AS v(key, value, description)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.payroll_constants pc
    WHERE pc.tenant_id = t.id AND pc.key = v.key
 );
