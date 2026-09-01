-- UAT D-15: configurable tenant policy plus day/site assessment. It records warnings; it deliberately does not create an override or deadline-resolution path.
create table public.annual_leave_capacity_policies (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 max_employees integer not null default 10 check(max_employees>0), effective_from date not null default current_date,
 policy_owner uuid not null references public.profiles(id), created_at timestamptz not null default now(), unique(tenant_id,effective_from)
);
alter table public.annual_leave_capacity_policies enable row level security;
create policy annual_leave_capacity_policy_read on public.annual_leave_capacity_policies for select to authenticated using(tenant_id=public.get_my_tenant_id() and public.get_my_role() in ('admin','operations','payroll'));
revoke all on public.annual_leave_capacity_policies from authenticated,anon;

create or replace function public.preview_annual_leave_capacity(p_request uuid) returns table(leave_date date,site_id uuid,approved_or_planned integer,monthly_employee_count integer,max_employees integer) language sql security definer set search_path=public as $$
 with r as (select * from public.leave_requests where id=p_request and tenant_id=public.get_my_tenant_id()), p as (
 select max_employees from public.annual_leave_capacity_policies where tenant_id=(select tenant_id from r) and effective_from<=current_date order by effective_from desc limit 1
 ) select d.leave_date, coalesce(d.original_site_id,e.home_site_id),
 (select count(distinct x.employee_id) from public.leave_request_days x join public.leave_requests xr on xr.id=x.request_id where xr.tenant_id=r.tenant_id and xr.leave_type='annual' and xr.status in ('submitted','approved') and x.leave_date=d.leave_date),
 (select count(distinct x.employee_id) from public.leave_request_days x join public.leave_requests xr on xr.id=x.request_id where xr.tenant_id=r.tenant_id and xr.leave_type='annual' and xr.status in ('submitted','approved') and date_trunc('month',x.leave_date)=date_trunc('month',d.leave_date)),
 coalesce((select max_employees from p),10)
 from r join public.leave_request_days d on d.request_id=r.id join public.employees e on e.id=r.employee_id;
$$;
grant execute on function public.preview_annual_leave_capacity(uuid) to authenticated;
