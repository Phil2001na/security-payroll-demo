-- UAT-11: employees need an individually-anchored annual leave cycle with the statutory
-- deadline visible, not just the cycle window. Labour Act 2007 s.23: the employer must
-- determine a leave time no later than four months after the annual-leave cycle ends
-- (uat/2026-08-20/UAT_REQUIREMENTS.md, "Important clarification of the leave discussion").
-- Only annual leave carries this deadline — sick/compassionate cycles have no equivalent
-- statutory scheduling rule, so the column stays null for those rows.
-- The six-month extension (requires the employee's written agreement before the four-month
-- period expires) is deliberately NOT modelled here: capturing that agreement is UAT-13
-- evidence work, which is still awaiting a client decision on the evidence standard.
alter table public.leave_cycles
  add column if not exists latest_leave_date date
  generated always as (
    case when leave_type = 'annual' then (cycle_end + interval '4 months')::date else null end
  ) stored;

comment on column public.leave_cycles.latest_leave_date is
  'Statutory deadline (Labour Act s.23) by which annual leave for this cycle must be taken; null for non-annual leave types.';
