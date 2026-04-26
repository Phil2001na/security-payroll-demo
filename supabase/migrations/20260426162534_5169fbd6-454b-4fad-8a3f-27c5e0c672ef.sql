
DROP VIEW IF EXISTS public.attendance_logs;
CREATE VIEW public.attendance_logs
  WITH (security_invoker = true)
  AS
  SELECT
    id, tenant_id, employee_id, site_id, shift_type_id, pay_period_id,
    assignment_id, date, hours_worked, night_hours, status,
    approved_by, approved_at, notes, created_at, updated_at
  FROM public.shift_logs;
