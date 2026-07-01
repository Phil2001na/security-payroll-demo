-- Editable reduced Sunday multiplier for employees who ordinarily work Sundays under a
-- written agreement (Labour Act s.21 — 1.5× instead of the 2× default). The engine reads
-- `sunday_agreed_multiplier` and applies it only to employees with ordinarily_works_sundays;
-- everyone else keeps the 2× `sunday_default_multiplier`.
INSERT INTO public.payroll_constants (tenant_id, key, value, description)
SELECT t.id, 'sunday_agreed_multiplier', 1.5,
       'Sunday multiplier for employees who ordinarily work Sundays under written agreement (Labour Act s.21 — 1.5x). Employees without the agreement use the 2x default.'
  FROM public.tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.payroll_constants pc
    WHERE pc.tenant_id = t.id AND pc.key = 'sunday_agreed_multiplier'
 );
