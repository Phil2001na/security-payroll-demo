-- Field supervisors are a site-level guard tier. They use daily muster to record
-- attendance and flag minor incidents; HR leave and employment-exit authority stays
-- with payroll, operations, and administration.

drop policy if exists employment_exits_role_insert on public.employment_exits;
create policy employment_exits_role_insert on public.employment_exits
  as restrictive for insert to authenticated
  with check (public.get_my_role() = any (array['admin', 'operations', 'supervisor', 'payroll']));

drop policy if exists leave_requests_read on public.leave_requests;
create policy leave_requests_read on public.leave_requests for select to authenticated using (
  tenant_id = (select public.get_my_tenant_id())
  and (select public.get_my_role()) in ('admin', 'operations', 'supervisor', 'payroll')
);

drop policy if exists leave_request_days_read on public.leave_request_days;
create policy leave_request_days_read on public.leave_request_days for select to authenticated using (
  tenant_id = (select public.get_my_tenant_id())
  and (select public.get_my_role()) in ('admin', 'operations', 'supervisor', 'payroll')
);

drop policy if exists leave_coverage_read on public.leave_coverage;
create policy leave_coverage_read on public.leave_coverage for select to authenticated using (
  tenant_id = (select public.get_my_tenant_id())
  and (select public.get_my_role()) in ('admin', 'operations', 'supervisor', 'payroll')
);

create or replace function public.submit_leave_request(
  p_employee uuid, p_type public.leave_type, p_start date, p_end date,
  p_reason text, p_evidence_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := get_my_tenant_id();
  v_role text := get_my_role();
  v_id uuid;
  v_policy leave_policies;
begin
  if (select auth.uid()) is null or v_tenant is null then raise exception 'Authentication required'; end if;
  if v_role not in ('admin','operations','supervisor','payroll') then raise exception 'Not permitted to submit leave'; end if;
  if p_end < p_start or p_end - p_start > 90 then raise exception 'Leave range must be 1 to 91 calendar days'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text, 0));
  if not exists (select 1 from employees where id = p_employee and tenant_id = v_tenant and status = 'active') then
    raise exception 'Active employee not found';
  end if;
  select * into v_policy from leave_policies where tenant_id=v_tenant and leave_type=p_type and active;
  if not found then raise exception 'Leave policy is not configured'; end if;
  if p_type not in ('sick','compassionate') and v_policy.minimum_notice_days>0
      and p_start-current_date < v_policy.minimum_notice_days then
    raise exception 'This leave type requires % days notice',v_policy.minimum_notice_days;
  end if;
  if p_type='maternity' and p_end-p_start+1<84 then
    raise exception 'Maternity leave must cover at least 12 consecutive weeks';
  end if;
  if exists (select 1 from leave_requests where employee_id = p_employee and status in ('submitted','approved')
      and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'This employee already has an overlapping leave request';
  end if;
  insert into leave_requests (tenant_id, employee_id, leave_type, start_date, end_date, reason, evidence_url, requested_by)
  values (v_tenant, p_employee, p_type, p_start, p_end, btrim(p_reason), nullif(btrim(p_evidence_url), ''), (select auth.uid())) returning id into v_id;
  insert into leave_request_days (tenant_id, request_id, employee_id, leave_date)
  select v_tenant, v_id, p_employee, d::date from generate_series(p_start, p_end, interval '1 day') d;
  return v_id;
end $$;
