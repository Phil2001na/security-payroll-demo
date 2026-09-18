-- UAT-14 follow-up. 20260830184500_leave_capacity_policy.sql created the table and the
-- preview function but revoked every privilege from `authenticated`, which left its own
-- SELECT policy unreachable and gave the cap no write path at all. Decision §6 of
-- DECISIONS-2026-09-03.md requires the cap to be "configurable with effective date and
-- policy owner", so the approving roles need to read it and admins need to maintain it.

grant select on public.annual_leave_capacity_policies to authenticated;
grant insert, update, delete on public.annual_leave_capacity_policies to authenticated;

-- Reading is already scoped by annual_leave_capacity_policy_read (admin/operations/payroll).
-- Maintaining the policy is narrower: it is a standing HR rule, not a rostering decision.
create policy annual_leave_capacity_policy_insert on public.annual_leave_capacity_policies
  for insert to authenticated with check (
    tenant_id = (select public.get_my_tenant_id())
    and (select public.get_my_role()) = 'admin'
  );

create policy annual_leave_capacity_policy_update on public.annual_leave_capacity_policies
  for update to authenticated using (
    tenant_id = (select public.get_my_tenant_id())
    and (select public.get_my_role()) = 'admin'
  ) with check (
    tenant_id = (select public.get_my_tenant_id())
    and (select public.get_my_role()) = 'admin'
  );

-- Deletion exists to withdraw a future-dated row entered in error. Past rows describe what
-- the cap was when earlier approvals were made, so removing them rewrites history; the UI
-- only offers delete on rows whose effective_from is still in the future.
create policy annual_leave_capacity_policy_delete on public.annual_leave_capacity_policies
  for delete to authenticated using (
    tenant_id = (select public.get_my_tenant_id())
    and (select public.get_my_role()) = 'admin'
  );

-- The policy table is pay-adjacent HR configuration, so changes to it are audited the same
-- way leave_requests and shift_types are.
create trigger trg_audit_annual_leave_capacity_policies
  after insert or update or delete on public.annual_leave_capacity_policies
  for each row execute function public.write_audit_event();

-- preview_annual_leave_capacity is SECURITY DEFINER and was scoped to the caller's tenant but
-- not to a role, so any authenticated tenant member could read colleagues' leave clustering.
-- Restrict it to the roles that can actually approve leave (see approve_leave_request).
-- Returning no rows rather than raising keeps the approver UI's "no policy yet" path simple.
create or replace function public.preview_annual_leave_capacity(p_request uuid)
returns table(leave_date date, site_id uuid, approved_or_planned integer,
              monthly_employee_count integer, max_employees integer)
language sql security definer set search_path = public as $$
 with r as (
   select * from public.leave_requests
   where id = p_request and tenant_id = public.get_my_tenant_id()
     and public.get_my_role() in ('admin','operations','payroll')
 ), p as (
 select max_employees from public.annual_leave_capacity_policies where tenant_id=(select tenant_id from r) and effective_from<=current_date order by effective_from desc limit 1
 ) select d.leave_date, coalesce(d.original_site_id,e.home_site_id),
 (select count(distinct x.employee_id) from public.leave_request_days x join public.leave_requests xr on xr.id=x.request_id where xr.tenant_id=r.tenant_id and xr.leave_type='annual' and xr.status in ('submitted','approved') and x.leave_date=d.leave_date),
 (select count(distinct x.employee_id) from public.leave_request_days x join public.leave_requests xr on xr.id=x.request_id where xr.tenant_id=r.tenant_id and xr.leave_type='annual' and xr.status in ('submitted','approved') and date_trunc('month',x.leave_date)=date_trunc('month',d.leave_date)),
 coalesce((select max_employees from p),10)
 from r join public.leave_request_days d on d.request_id=r.id join public.employees e on e.id=r.employee_id;
$$;
