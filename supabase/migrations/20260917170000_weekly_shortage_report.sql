-- UAT-10 — the weekly Operations/HR shortage report.
--
-- Decision §8 of DECISIONS-2026-09-03.md closed UAT-17 as "shortage reporting only, no
-- applicant pipeline", and named the deliverable: group recurring shortages by site, shift and
-- required skill so Operations and HR can see where to recruit.
--
-- The register (schedule_shortages) and its 30-day scheduler view already existed. What was
-- missing is the aggregate: one unfilled Tuesday night is an incident, the same Tuesday night
-- unfilled for six weeks is a vacancy, and only the second one tells HR to hire.
--
-- "Required skill" is sites.required_guard_grade — the literacy grade a site demands, which is
-- what the auto-fill candidate ranking already scores against (gradeFitScore). It is the only
-- skill requirement in the schema; site_requirements carries quantity and shift kind but no
-- competency. Most sites leave it null, meaning any grade will do, and the report says so
-- rather than showing a blank column.
--
-- SECURITY INVOKER (the default) on purpose: schedule_shortages already has an RLS policy that
-- scopes reads by tenant, by role, and by assigned site for a security_supervisor. Running as
-- the caller inherits all of that. A SECURITY DEFINER function would have to re-implement that
-- policy and would silently drift from it.

create or replace function public.report_weekly_shortages(p_weeks integer default 8)
returns table (
  week_start date,
  site_id uuid,
  site_name text,
  shift_kind text,
  required_grade text,
  occurrences integer,
  days_affected integer,
  total_unmet integer
)
language sql
stable
set search_path = public
as $fn$
  select
    date_trunc('week', s.shortage_date)::date as week_start,
    s.site_id,
    si.name as site_name,
    s.shift_kind,
    -- null means the site sets no grade requirement; say that rather than leaving a gap.
    coalesce(si.required_guard_grade::text, 'Any') as required_grade,
    count(*)::integer as occurrences,
    count(distinct s.shortage_date)::integer as days_affected,
    sum(s.unmet_count)::integer as total_unmet
  from public.schedule_shortages s
  join public.sites si on si.id = s.site_id
  where s.shortage_date >= (current_date - (greatest(coalesce(p_weeks, 8), 1) * 7))
  group by 1, 2, 3, 4, 5
  order by week_start desc, total_unmet desc, si.name;
$fn$;

grant execute on function public.report_weekly_shortages(integer) to authenticated;
