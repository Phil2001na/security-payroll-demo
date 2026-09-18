-- UAT-14 correctness fix. Decision §6 of DECISIONS-2026-09-03.md asks for two distinct
-- figures: a *tenant-wide* monthly headcount cap, and a *per-site, day-level* coverage check
-- at the employee's home site. The original function computed both counts tenant-wide and
-- returned site_id without ever filtering on it, so the day figure answered "how many people
-- are off company-wide" — which is not the question an approver worrying about coverage at
-- one gate is asking. A 40-site tenant would show an alarming day count that says nothing
-- about whether the site the guard actually works is covered.
--
-- The monthly count stays tenant-wide: that one is the headcount cap and is correct as-is.
-- A leave day's site is coalesce(original_site_id, home_site_id) — original_site_id is the
-- site the guard was actually rostered at that day, which is the better answer when it exists.

create or replace function public.preview_annual_leave_capacity(p_request uuid)
returns table(leave_date date, site_id uuid, approved_or_planned integer,
              monthly_employee_count integer, max_employees integer)
language sql security definer set search_path = public as $$
  with r as (
    select * from public.leave_requests
    where id = p_request and tenant_id = public.get_my_tenant_id()
      and public.get_my_role() in ('admin','operations','payroll')
  ),
  p as (
    select max_employees from public.annual_leave_capacity_policies
    where tenant_id = (select tenant_id from r) and effective_from <= current_date
    order by effective_from desc limit 1
  ),
  -- Every annual leave day in this tenant that is in play, resolved to its effective site.
  taken as (
    select x.leave_date, x.employee_id,
           coalesce(x.original_site_id, e.home_site_id) as site_id
    from public.leave_request_days x
    join public.leave_requests xr on xr.id = x.request_id
    join public.employees e on e.id = x.employee_id
    where xr.tenant_id = (select tenant_id from r)
      and xr.leave_type = 'annual'
      and xr.status in ('submitted','approved')
  ),
  -- The days of the request under review, each resolved the same way.
  want as (
    select d.leave_date, coalesce(d.original_site_id, e.home_site_id) as site_id
    from r
    join public.leave_request_days d on d.request_id = r.id
    join public.employees e on e.id = r.employee_id
  )
  select w.leave_date,
         w.site_id,
         (select count(distinct t.employee_id)::integer from taken t
          where t.leave_date = w.leave_date and t.site_id is not distinct from w.site_id),
         (select count(distinct t.employee_id)::integer from taken t
          where date_trunc('month', t.leave_date) = date_trunc('month', w.leave_date)),
         coalesce((select max_employees from p), 10)
  from want w
  order by w.leave_date;
$$;
