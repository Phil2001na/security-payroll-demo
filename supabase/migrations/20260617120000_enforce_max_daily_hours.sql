-- Labour-law guard: a single shift (and the assignments built from it) must not
-- exceed the ~12h daily maximum for security guards. Leave shift types (e.g. AL)
-- are exempt since they carry 0 hours and represent time off, not a worked shift.
ALTER TABLE public.shift_types
  ADD CONSTRAINT shift_types_max_daily_hours
  CHECK (is_leave OR default_hours <= 12);

ALTER TABLE public.schedule_assignments
  ADD CONSTRAINT schedule_assignments_max_daily_hours
  CHECK (planned_hours <= 12);
