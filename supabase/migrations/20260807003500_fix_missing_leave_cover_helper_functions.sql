-- Bug found in Round 2 verify-tracker (#3, leave module UAT): assign_leave_cover()
-- (from 20260803181750_leave_management_module.sql) calls employee_week_hours() and
-- has_ps_exemption(), both of which were originally defined in
-- 20260426162519_f6d060a5-255f-4532-9d21-5bc067cf4c17.sql — but that migration never
-- actually ran against the live database, so both functions are missing live even though
-- the table they depend on (ps_exemptions) does exist. Every relief-cover assignment on a
-- leave request has therefore been failing with "function employee_week_hours(uuid, date)
-- does not exist" since the leave module went live. Fix: (re)create the two functions
-- exactly as originally authored — no new logic, no other schema changes.

CREATE OR REPLACE FUNCTION public.employee_week_hours(_employee_id UUID, _any_date DATE)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(planned_hours), 0)::numeric
  FROM public.schedule_assignments
  WHERE employee_id = _employee_id
    AND date_trunc('week', date)::date = date_trunc('week', _any_date)::date
$$;

CREATE OR REPLACE FUNCTION public.has_ps_exemption(_employee_id UUID, _date DATE)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ps_exemptions
    WHERE employee_id = _employee_id
      AND _date BETWEEN effective_from AND effective_to
  )
$$;
