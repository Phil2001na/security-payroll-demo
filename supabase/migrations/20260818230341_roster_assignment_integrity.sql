-- Keep every write path (manual roster cells, auto-fill, custom coverage and API clients)
-- subject to the same core safety rules. Existing monthly rest and hour-cap triggers remain
-- responsible for their respective period rules.
CREATE OR REPLACE FUNCTION public.enforce_roster_assignment_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_work boolean;
  v_kind text;
  v_week_hours numeric;
  v_worked_days integer;
BEGIN
  SELECT NOT st.is_leave AND st.default_hours > 0,
         CASE
           WHEN st.period = 'night' THEN 'night'
           WHEN st.period IN ('day', 'full_day', 'morning') THEN 'day'
           ELSE NULL
         END
    INTO v_is_work, v_kind
    FROM public.shift_types st
   WHERE st.id = NEW.shift_type_id;

  IF NOT COALESCE(v_is_work, false) THEN
    RETURN NEW;
  END IF;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Rostered work must use a Day or Night shift type'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.schedule_assignments sa
      JOIN public.shift_types st ON st.id = sa.shift_type_id
     WHERE sa.employee_id = NEW.employee_id
       AND sa.date = NEW.date
       AND sa.id <> NEW.id
       AND NOT st.is_leave
       AND st.default_hours > 0
  ) THEN
    RAISE EXCEPTION 'Guard already has a working shift on %', NEW.date
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(sa.planned_hours), 0)
    INTO v_week_hours
    FROM public.schedule_assignments sa
    JOIN public.shift_types st ON st.id = sa.shift_type_id
   WHERE sa.employee_id = NEW.employee_id
     AND date_trunc('week', sa.date)::date = date_trunc('week', NEW.date)::date
     AND sa.id <> NEW.id
     AND NOT st.is_leave
     AND st.default_hours > 0;

  IF v_week_hours + NEW.planned_hours > 60
     AND NOT public.has_ps_exemption(NEW.employee_id, NEW.date) THEN
    RAISE EXCEPTION 'Weekly hour cap exceeded: this would put the guard on % hours',
      v_week_hours + NEW.planned_hours
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(DISTINCT sa.date)
    INTO v_worked_days
    FROM public.schedule_assignments sa
    JOIN public.shift_types st ON st.id = sa.shift_type_id
   WHERE sa.employee_id = NEW.employee_id
     AND date_trunc('week', sa.date)::date = date_trunc('week', NEW.date)::date
     AND sa.id <> NEW.id
     AND NOT st.is_leave
     AND st.default_hours > 0;

  IF v_worked_days >= 6 THEN
    RAISE EXCEPTION 'Weekly rest breached: this would leave the guard without a full day off'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_kind = 'day' AND EXISTS (
    SELECT 1
      FROM public.schedule_assignments sa
      JOIN public.shift_types st ON st.id = sa.shift_type_id
     WHERE sa.employee_id = NEW.employee_id
       AND sa.date = NEW.date - 1
       AND sa.id <> NEW.id
       AND NOT st.is_leave
       AND st.period = 'night'
  ) THEN
    RAISE EXCEPTION 'Insufficient rest: a Night shift cannot be followed by a Day shift'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_kind = 'night' AND EXISTS (
    SELECT 1
      FROM public.schedule_assignments sa
      JOIN public.shift_types st ON st.id = sa.shift_type_id
     WHERE sa.employee_id = NEW.employee_id
       AND sa.date = NEW.date + 1
       AND sa.id <> NEW.id
       AND NOT st.is_leave
       AND st.period IN ('day', 'full_day', 'morning')
  ) THEN
    RAISE EXCEPTION 'Insufficient rest: a Day shift cannot follow a Night shift'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS schedule_assignments_integrity_guard ON public.schedule_assignments;
CREATE TRIGGER schedule_assignments_integrity_guard
BEFORE INSERT OR UPDATE OF employee_id, date, shift_type_id, planned_hours
ON public.schedule_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_roster_assignment_integrity();
