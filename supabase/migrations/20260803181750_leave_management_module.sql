-- End-to-end leave management for an irregular security roster.
-- Requests are charged against scheduled working dates, never weekday assumptions.
-- Submission and approval are deliberately two-person; leave is not punitive and does
-- not use the disciplinary three-person chain.

create type public.leave_type as enum ('annual', 'sick', 'compassionate', 'maternity', 'unpaid');
create type public.leave_request_status as enum ('submitted', 'approved', 'rejected', 'cancelled');
create type public.leave_ledger_entry_type as enum ('opening', 'entitlement', 'accrual', 'usage', 'reversal', 'adjustment', 'expiry');
create type public.leave_coverage_status as enum ('open', 'assigned', 'waived', 'cancelled');

create table public.leave_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  leave_type public.leave_type not null,
  label text not null,
  paid_percent numeric(5,2) not null default 100 check (paid_percent between 0 and 100),
  constraint leave_policies_statutory_pay check (
    (leave_type in ('annual','sick','compassionate') and paid_percent=100)
    or leave_type='maternity'
    or (leave_type='unpaid' and paid_percent=0)
  ),
  balance_enforced boolean not null default true,
  allow_negative boolean not null default false,
  constraint leave_policies_nonbalance_types check (
    leave_type not in ('maternity','unpaid') or (not balance_enforced and not allow_negative)
  ),
  minimum_notice_days integer not null default 0 check (minimum_notice_days >= 0),
  evidence_required_after_days numeric(6,2) check (evidence_required_after_days > 0),
  maximum_consecutive_days numeric(6,2) check (maximum_consecutive_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, leave_type)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type public.leave_type not null,
  start_date date not null,
  end_date date not null,
  reason text not null check (length(btrim(reason)) > 0),
  evidence_url text,
  status public.leave_request_status not null default 'submitted',
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_notes text,
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  charged_units numeric(7,2) not null default 0 check (charged_units >= 0),
  balance_charged boolean not null default false,
  paid_percent numeric(5,2) not null default 100 check (paid_percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (decided_by is null or decided_by <> requested_by)
);

create table public.leave_request_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.leave_requests(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_date date not null,
  charge_units numeric(5,2) not null default 0 check (charge_units between 0 and 1),
  paid_hours numeric(5,2) not null default 0 check (paid_hours >= 0),
  original_assignment_id uuid references public.schedule_assignments(id) on delete set null,
  original_site_id uuid references public.sites(id),
  original_shift_type_id uuid references public.shift_types(id),
  original_planned_hours numeric(5,2),
  created_at timestamptz not null default now(),
  unique (request_id, leave_date)
);

create table public.leave_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type public.leave_type not null check (leave_type in ('annual','sick','compassionate')),
  cycle_start date not null,
  cycle_end date not null,
  entitlement_units numeric(7,2) not null check (entitlement_units >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cycle_end >= cycle_start),
  unique(employee_id,leave_type,cycle_start)
);

alter table public.schedule_assignments
  add column if not exists leave_request_day_id uuid references public.leave_request_days(id) on delete set null;

alter table public.payroll_runs
  add column if not exists annual_leave_hours numeric not null default 0,
  add column if not exists sick_leave_hours numeric not null default 0,
  add column if not exists compassionate_leave_hours numeric not null default 0,
  add column if not exists maternity_leave_hours numeric not null default 0,
  add column if not exists maternity_paid_hours numeric not null default 0,
  add column if not exists unpaid_leave_hours numeric not null default 0;

create table public.leave_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type public.leave_type not null,
  entry_type public.leave_ledger_entry_type not null,
  units numeric(8,4) not null check (units <> 0),
  cycle_id uuid references public.leave_cycles(id) on delete restrict,
  request_id uuid references public.leave_requests(id) on delete restrict,
  pay_period_id uuid references public.pay_periods(id) on delete restrict,
  reference text,
  effective_date date not null default current_date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.leave_coverage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_day_id uuid not null references public.leave_request_days(id) on delete cascade,
  original_assignment_id uuid not null unique references public.schedule_assignments(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  leave_employee_id uuid not null references public.employees(id) on delete cascade,
  shift_type_id uuid not null references public.shift_types(id),
  planned_hours numeric(5,2) not null check (planned_hours > 0),
  coverage_date date not null,
  status public.leave_coverage_status not null default 'open',
  replacement_employee_id uuid references public.employees(id),
  replacement_assignment_id uuid references public.schedule_assignments(id) on delete set null,
  waived_reason text,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (replacement_employee_id is null or replacement_employee_id <> leave_employee_id)
);

create index leave_policies_tenant_idx on public.leave_policies (tenant_id);
create index leave_requests_employee_dates_idx on public.leave_requests (employee_id, start_date, end_date);
create index leave_requests_tenant_status_idx on public.leave_requests (tenant_id, status, start_date);
create unique index leave_requests_no_active_overlap_idx
  on public.leave_requests (employee_id, start_date, end_date)
  where status in ('submitted', 'approved');
create index leave_request_days_employee_date_idx on public.leave_request_days (employee_id, leave_date);
create index leave_cycles_employee_type_dates_idx on public.leave_cycles(employee_id,leave_type,cycle_start,cycle_end);
create index leave_ledger_employee_type_date_idx on public.leave_ledger (employee_id, leave_type, effective_date, created_at);
create unique index leave_ledger_one_usage_per_request_idx on public.leave_ledger (request_id, leave_type)
  where entry_type = 'usage';
create unique index leave_ledger_one_reversal_per_request_idx on public.leave_ledger (request_id, leave_type)
  where entry_type = 'reversal';
create unique index leave_ledger_one_accrual_per_period_idx on public.leave_ledger (employee_id, pay_period_id, leave_type)
  where entry_type = 'accrual';
create unique index leave_ledger_one_entitlement_per_cycle_idx on public.leave_ledger(cycle_id)
  where entry_type='entitlement';
create index leave_coverage_open_idx on public.leave_coverage (tenant_id, coverage_date, site_id)
  where status = 'open';
create index leave_coverage_request_day_idx on public.leave_coverage (request_day_id);
create index schedule_assignments_leave_day_idx on public.schedule_assignments (leave_request_day_id)
  where leave_request_day_id is not null;

create trigger leave_policies_touch before update on public.leave_policies for each row execute function public.touch_updated_at();
create trigger leave_requests_touch before update on public.leave_requests for each row execute function public.touch_updated_at();
create trigger leave_cycles_touch before update on public.leave_cycles for each row execute function public.touch_updated_at();
create trigger leave_coverage_touch before update on public.leave_coverage for each row execute function public.touch_updated_at();

insert into public.leave_policies (tenant_id, leave_type, label, paid_percent, balance_enforced, allow_negative, evidence_required_after_days)
select t.id, x.leave_type::public.leave_type, x.label, x.paid_percent, x.balance_enforced, false, x.evidence_after
from public.tenants t
cross join (values
  ('annual', 'Annual leave', 100::numeric, true, null::numeric),
  ('sick', 'Sick leave', 100::numeric, true, 3::numeric),
  ('compassionate', 'Compassionate leave', 100::numeric, true, null::numeric),
  ('maternity', 'Maternity leave', 0::numeric, false, null::numeric),
  ('unpaid', 'Unpaid leave', 0::numeric, false, null::numeric)
) as x(leave_type, label, paid_percent, balance_enforced, evidence_after)
on conflict (tenant_id, leave_type) do nothing;

insert into public.shift_types (tenant_id, code, label, day_of_week, period, default_hours, pay_rule, rate_multiplier, is_leave, active)
select t.id, x.code, x.label, 'any', 'full_day', 12, x.pay_rule::public.pay_rule, x.multiplier, true, true
from public.tenants t
cross join (values
  ('LEAVE-ANNUAL', 'Annual leave', 'leave', 1::numeric),
  ('LEAVE-SICK', 'Sick leave', 'leave', 1::numeric),
  ('LEAVE-COMPASSIONATE', 'Compassionate leave', 'leave', 1::numeric),
  ('LEAVE-MATERNITY', 'Maternity leave', 'off', 0::numeric),
  ('LEAVE-UNPAID', 'Unpaid leave', 'off', 0::numeric)
) as x(code, label, pay_rule, multiplier)
on conflict (tenant_id, code) do update set label = excluded.label, pay_rule = excluded.pay_rule,
  rate_multiplier = excluded.rate_multiplier, is_leave = true, active = true;

-- One opening row preserves the current balance while the immutable ledger takes over.
insert into public.leave_ledger (tenant_id, employee_id, leave_type, entry_type, units, reference)
select lb.tenant_id, lb.employee_id, x.leave_type::public.leave_type, 'opening', x.units, 'Opening balance migrated from leave_balances'
from public.leave_balances lb
cross join lateral (values
  ('annual', lb.annual_days), ('sick', lb.sick_days), ('compassionate', lb.compassionate_days)
) as x(leave_type, units)
where x.units <> 0;

alter table public.leave_policies enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_request_days enable row level security;
alter table public.leave_cycles enable row level security;
alter table public.leave_ledger enable row level security;
alter table public.leave_coverage enable row level security;

create policy leave_policies_read on public.leave_policies for select to authenticated
  using (tenant_id = (select public.get_my_tenant_id()));
create policy leave_requests_read on public.leave_requests for select to authenticated using (
  tenant_id = (select public.get_my_tenant_id()) and (
    (select public.get_my_role()) in ('admin','operations','supervisor','payroll')
    or ((select public.get_my_role()) = 'security_supervisor' and exists (
      select 1 from public.employees e where e.id=leave_requests.employee_id and e.home_site_id=any(public.current_site_ids())
    ))
  )
);
create policy leave_request_days_read on public.leave_request_days for select to authenticated
  using (
    tenant_id = (select public.get_my_tenant_id()) and exists (
      select 1 from public.leave_requests r where r.id = leave_request_days.request_id
    )
  );
create policy leave_ledger_read on public.leave_ledger for select to authenticated using (
  tenant_id=(select public.get_my_tenant_id()) and (select public.get_my_role()) in ('admin','operations','supervisor','payroll')
);
create policy leave_cycles_read on public.leave_cycles for select to authenticated using (
  tenant_id=(select public.get_my_tenant_id()) and (select public.get_my_role()) in ('admin','operations','supervisor','payroll')
);
create policy leave_coverage_read on public.leave_coverage for select to authenticated using (
  tenant_id=(select public.get_my_tenant_id()) and (
    (select public.get_my_role()) in ('admin','operations','supervisor','payroll')
    or ((select public.get_my_role())='security_supervisor' and site_id=any(public.current_site_ids()))
  )
);

grant select on public.leave_policies, public.leave_requests, public.leave_request_days,
  public.leave_cycles, public.leave_ledger, public.leave_coverage to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.prevent_leave_ledger_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Leave ledger entries are immutable; post a reversal or adjustment instead';
end $$;
create trigger leave_ledger_immutable before update or delete on public.leave_ledger
for each row execute function private.prevent_leave_ledger_mutation();

create or replace function private.leave_balance_column(p_type public.leave_type)
returns text language sql immutable set search_path = '' as $$
  select case p_type when 'annual' then 'annual_days' when 'sick' then 'sick_days'
    when 'compassionate' then 'compassionate_days' else null end
$$;

create or replace function private.apply_leave_balance(
  p_tenant uuid, p_employee uuid, p_type public.leave_type, p_units numeric
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.leave_balances (tenant_id, employee_id) values (p_tenant, p_employee)
  on conflict (employee_id) do nothing;
  perform 1 from public.leave_balances where tenant_id = p_tenant and employee_id = p_employee for update;
  if p_type = 'annual' then
    update public.leave_balances set annual_days = annual_days + p_units, updated_at = now()
    where tenant_id = p_tenant and employee_id = p_employee;
  elsif p_type = 'sick' then
    update public.leave_balances set sick_days = sick_days + p_units, updated_at = now()
    where tenant_id = p_tenant and employee_id = p_employee;
  elsif p_type = 'compassionate' then
    update public.leave_balances set compassionate_days = compassionate_days + p_units, updated_at = now()
    where tenant_id = p_tenant and employee_id = p_employee;
  end if;
end $$;

create or replace function private.leave_balance_value(p_tenant uuid, p_employee uuid, p_type public.leave_type)
returns numeric language sql stable security definer set search_path = '' as $$
  select case p_type when 'annual' then annual_days when 'sick' then sick_days
    when 'compassionate' then compassionate_days else 0 end
  from public.leave_balances where tenant_id = p_tenant and employee_id = p_employee
$$;

-- Establish and roll the statutory sick/compassionate cycles. Sick leave is 30 days
-- for a five-day week or 36 for six days over 36 months (pro rata otherwise), with
-- one day per 26 days worked during year one. Compassionate leave is five days per year.
create or replace function private.ensure_statutory_leave_cycles(
  p_tenant uuid,p_employee uuid,p_as_of date
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_type public.leave_type; v_start date; v_cycle_start date; v_cycle_end date;
  v_cycle_months integer; v_elapsed integer; v_entitlement numeric; v_existing public.leave_cycles;
  v_balance numeric; v_delta numeric; v_worked numeric; v_days_per_week numeric; v_has_prior boolean;
begin
  select coalesce(e.start_date,e.created_at::date),least(6,greatest(1,e.days_per_week))
    into v_start,v_days_per_week
  from public.employees e where e.id=p_employee and e.tenant_id=p_tenant;
  if not found then raise exception 'Employee not found'; end if;

  foreach v_type in array array['annual'::public.leave_type,'sick'::public.leave_type,'compassionate'::public.leave_type] loop
    v_cycle_months := case when v_type='sick' then 36 else 12 end;
    v_elapsed := greatest(0,(extract(year from age(p_as_of,v_start))::integer*12)+extract(month from age(p_as_of,v_start))::integer);
    v_cycle_start := (v_start + make_interval(months => (v_elapsed/v_cycle_months)*v_cycle_months))::date;
    v_cycle_end := (v_cycle_start + make_interval(months => v_cycle_months) - interval '1 day')::date;

    if v_type='annual' then
      v_entitlement := round(v_days_per_week*4,2);
    elsif v_type='compassionate' then
      v_entitlement := 5;
    elsif p_as_of < v_start + interval '1 year' then
      select floor(count(distinct sl.date)::numeric/26) into v_worked
      from public.shift_logs sl join public.shift_types st on st.id=sl.shift_type_id
      where sl.employee_id=p_employee and sl.tenant_id=p_tenant and sl.status='approved'
        and sl.date between v_start and p_as_of and not st.is_leave and st.pay_rule<>'off';
      v_entitlement := coalesce(v_worked,0);
    else
      v_entitlement := round(v_days_per_week*6,2);
    end if;

    select * into v_existing from public.leave_cycles
    where employee_id=p_employee and leave_type=v_type and cycle_start=v_cycle_start for update;
    if found then
      if v_entitlement>v_existing.entitlement_units then
        update public.leave_cycles set entitlement_units=v_entitlement where id=v_existing.id;
        if v_type<>'annual' then
          v_delta:=v_entitlement-v_existing.entitlement_units;
          insert into public.leave_ledger(tenant_id,employee_id,leave_type,entry_type,units,cycle_id,reference,effective_date)
          values(p_tenant,p_employee,v_type,'adjustment',v_delta,v_existing.id,'Statutory entitlement top-up',p_as_of);
          perform private.apply_leave_balance(p_tenant,p_employee,v_type,v_delta);
        end if;
      end if;
      continue;
    end if;

    -- Sick and compassionate balances lapse at cycle end. Expire only their current
    -- projection before granting the next cycle; annual leave is deliberately untouched.
    select exists(select 1 from public.leave_cycles where employee_id=p_employee and leave_type=v_type)
      into v_has_prior;
    if v_type<>'annual' then
      v_balance:=coalesce(private.leave_balance_value(p_tenant,p_employee,v_type),0);
      if v_has_prior and v_balance<>0 then
        insert into public.leave_ledger(tenant_id,employee_id,leave_type,entry_type,units,reference,effective_date)
        values(p_tenant,p_employee,v_type,'expiry',-v_balance,'Unused balance expired at statutory cycle end',v_cycle_start);
        perform private.apply_leave_balance(p_tenant,p_employee,v_type,-v_balance);
      end if;
    end if;

    insert into public.leave_cycles(tenant_id,employee_id,leave_type,cycle_start,cycle_end,entitlement_units)
    values(p_tenant,p_employee,v_type,v_cycle_start,v_cycle_end,v_entitlement) returning * into v_existing;
    v_delta := case
      when v_type='annual' then 0
      when v_has_prior then v_entitlement
      else greatest(0,v_entitlement-greatest(v_balance,0))
    end;
    if v_delta>0 then
      insert into public.leave_ledger(tenant_id,employee_id,leave_type,entry_type,units,cycle_id,reference,effective_date)
      values(p_tenant,p_employee,v_type,'entitlement',v_delta,v_existing.id,'Statutory cycle entitlement',v_cycle_start);
      perform private.apply_leave_balance(p_tenant,p_employee,v_type,v_delta);
    end if;
  end loop;
end $$;

do $$ declare e record; begin
  for e in select tenant_id,id from public.employees where status<>'terminated' and category='officer' loop
    perform private.ensure_statutory_leave_cycles(e.tenant_id,e.id,current_date);
  end loop;
end $$;

create or replace function public.submit_leave_request(
  p_employee uuid, p_type public.leave_type, p_start date, p_end date,
  p_reason text, p_evidence_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := get_my_tenant_id(); v_role text := get_my_role(); v_id uuid; v_home_site uuid; v_policy leave_policies;
begin
  if (select auth.uid()) is null or v_tenant is null then raise exception 'Authentication required'; end if;
  if v_role not in ('admin','operations','supervisor','payroll','security_supervisor') then raise exception 'Not permitted to submit leave'; end if;
  if p_end < p_start or p_end - p_start > 90 then raise exception 'Leave range must be 1 to 91 calendar days'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text, 0));
  select home_site_id into v_home_site from employees where id = p_employee and tenant_id = v_tenant and status = 'active';
  if not found then raise exception 'Active employee not found'; end if;
  if v_role = 'security_supervisor' and not (v_home_site = any(current_site_ids())) then raise exception 'Employee is outside your assigned sites'; end if;
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

create or replace function public.approve_leave_request(p_request uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := get_my_tenant_id(); v_role text := get_my_role(); v_req leave_requests;
  v_policy leave_policies; v_units numeric; v_balance numeric; v_leave_shift uuid; v_period uuid;
  v_employee_start date; d record;
begin
  if (select auth.uid()) is null or v_role not in ('admin','operations','payroll') then raise exception 'Only admin, operations or payroll can approve leave'; end if;
  select * into v_req from leave_requests where id = p_request and tenant_id = v_tenant for update;
  if not found then raise exception 'Leave request not found'; end if;
  if v_req.status <> 'submitted' then raise exception 'Leave request is already %', v_req.status; end if;
  if v_req.requested_by = (select auth.uid()) then raise exception 'The requester cannot approve their own leave submission'; end if;
  if exists (select 1 from pay_periods where tenant_id = v_tenant and status <> 'open'
      and daterange(start_date, end_date, '[]') && daterange(v_req.start_date, v_req.end_date, '[]')) then
    raise exception 'Leave overlaps a locked payroll period';
  end if;
  select * into v_policy from leave_policies where tenant_id = v_tenant and leave_type = v_req.leave_type and active;
  if not found then raise exception 'Leave policy is not configured'; end if;
  if v_req.leave_type='maternity' then
    select coalesce(start_date,created_at::date) into v_employee_start from employees where id=v_req.employee_id;
    if v_req.start_date < v_employee_start + interval '6 months' then
      raise exception 'Maternity leave requires six months of continuous service';
    end if;
  end if;
  select id into v_leave_shift from shift_types where tenant_id = v_tenant and code = 'LEAVE-' || upper(v_req.leave_type::text);
  if v_leave_shift is null then raise exception 'Leave shift type is not configured'; end if;

  for d in
    select lrd.id day_id, lrd.leave_date, sa.id assignment_id, sa.site_id, sa.shift_type_id, sa.planned_hours
    from leave_request_days lrd
    left join schedule_assignments sa on sa.employee_id = lrd.employee_id and sa.date = lrd.leave_date
      and sa.leave_request_day_id is null
    left join shift_types st on st.id = sa.shift_type_id
    where lrd.request_id = p_request and (sa.id is null or (st.is_leave = false and st.pay_rule <> 'off'))
    order by lrd.leave_date, sa.id
  loop
    if d.assignment_id is not null then
      if exists(select 1 from shift_logs where assignment_id=d.assignment_id and status='approved' and hours_worked > 0) then
        raise exception 'Approved worked attendance already exists for %; resolve attendance before approving leave', d.leave_date;
      end if;
      update leave_request_days set charge_units = 1,
        paid_hours = paid_hours + round(d.planned_hours * v_policy.paid_percent / 100.0, 2),
        original_assignment_id = coalesce(original_assignment_id,d.assignment_id), original_site_id = coalesce(original_site_id,d.site_id),
        original_shift_type_id = coalesce(original_shift_type_id,d.shift_type_id), original_planned_hours = coalesce(original_planned_hours,d.planned_hours)
      where id = d.day_id;
      update schedule_assignments set shift_type_id = v_leave_shift, leave_request_day_id = d.day_id,
        notes = concat_ws(' | ', nullif(notes,''), 'Approved ' || v_req.leave_type::text || ' leave')
      where id = d.assignment_id;
      insert into leave_coverage (tenant_id, request_day_id, original_assignment_id, site_id, leave_employee_id, shift_type_id, planned_hours, coverage_date)
      values (v_tenant, d.day_id, d.assignment_id, d.site_id, v_req.employee_id, d.shift_type_id, d.planned_hours, d.leave_date);
      select id into v_period from pay_periods where tenant_id=v_tenant and status='open'
        and d.leave_date between start_date and end_date order by start_date desc limit 1;
      if v_period is not null then
        -- A retrospective sick request may replace a pending/no-show log. The audit
        -- trigger preserves that transition; one canonical leave log prevents double pay.
        delete from shift_logs where assignment_id=d.assignment_id;
        insert into shift_logs(tenant_id,assignment_id,employee_id,pay_period_id,date,site_id,shift_type_id,hours_worked,night_hours,status,approved_by,approved_at,notes)
        values (v_tenant,d.assignment_id,v_req.employee_id,v_period,d.leave_date,d.site_id,v_leave_shift,
          round(d.planned_hours*v_policy.paid_percent/100.0,2),0,'approved',(select auth.uid()),now(),'Approved '||v_req.leave_type::text||' leave');
      end if;
    end if;
  end loop;
  select coalesce(sum(charge_units),0) into v_units from leave_request_days where request_id = p_request;
  if v_units = 0 then
    raise exception 'No rostered working shifts fall inside this request. Publish the roster before approving leave';
  end if;
  if v_policy.maximum_consecutive_days is not null and v_units > v_policy.maximum_consecutive_days then raise exception 'Request exceeds the configured consecutive-day limit'; end if;
  if v_policy.evidence_required_after_days is not null and v_units >= v_policy.evidence_required_after_days and v_req.evidence_url is null then raise exception 'Supporting evidence is required for this request'; end if;
  perform private.ensure_statutory_leave_cycles(v_tenant,v_req.employee_id,v_req.start_date);
  if v_policy.balance_enforced and v_req.leave_type <> 'unpaid' then
    perform 1 from leave_balances where tenant_id = v_tenant and employee_id = v_req.employee_id for update;
    v_balance := coalesce(private.leave_balance_value(v_tenant, v_req.employee_id, v_req.leave_type), 0);
    if not v_policy.allow_negative and v_balance < v_units then raise exception 'Insufficient leave balance: % available, % requested', v_balance, v_units; end if;
  end if;
  if v_units > 0 and v_req.leave_type <> 'unpaid' then
    insert into leave_ledger (tenant_id, employee_id, leave_type, entry_type, units, request_id, reference, effective_date, created_by)
    values (v_tenant, v_req.employee_id, v_req.leave_type, 'usage', -v_units, p_request, 'Approved leave', v_req.start_date, (select auth.uid()));
    if v_policy.balance_enforced then
      perform private.apply_leave_balance(v_tenant, v_req.employee_id, v_req.leave_type, -v_units);
    end if;
  end if;
  update leave_requests set status = 'approved', decided_by = (select auth.uid()), decided_at = now(),
    decision_notes = nullif(btrim(p_notes),''), charged_units = v_units,
    balance_charged = v_policy.balance_enforced and v_req.leave_type <> 'unpaid',
    paid_percent = v_policy.paid_percent where id = p_request;
end $$;

create or replace function public.reject_leave_request(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := get_my_tenant_id(); v_req leave_requests;
begin
  if (select auth.uid()) is null or get_my_role() not in ('admin','operations','payroll') then raise exception 'Not permitted to reject leave'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  select * into v_req from leave_requests where id = p_request and tenant_id = v_tenant for update;
  if not found or v_req.status <> 'submitted' then raise exception 'Submitted leave request not found'; end if;
  if v_req.requested_by = (select auth.uid()) then raise exception 'The requester cannot decide their own leave submission'; end if;
  update leave_requests set status = 'rejected', decided_by = (select auth.uid()), decided_at = now(), decision_notes = btrim(p_reason) where id = p_request;
end $$;

create or replace function public.cancel_leave_request(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := get_my_tenant_id(); v_req leave_requests; d record;
begin
  if (select auth.uid()) is null or get_my_role() not in ('admin','operations','payroll') then raise exception 'Not permitted to cancel leave'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A cancellation reason is required'; end if;
  select * into v_req from leave_requests where id = p_request and tenant_id = v_tenant for update;
  if not found or v_req.status not in ('submitted','approved') then raise exception 'Active leave request not found'; end if;
  if v_req.status = 'approved' then
    if exists (select 1 from pay_periods where tenant_id = v_tenant and status <> 'open'
        and daterange(start_date,end_date,'[]') && daterange(v_req.start_date,v_req.end_date,'[]')) then raise exception 'Cannot cancel leave in a locked payroll period'; end if;
    if exists (select 1 from leave_coverage lc join shift_logs sl on sl.assignment_id = lc.replacement_assignment_id where lc.request_day_id in (select id from leave_request_days where request_id=p_request)) then raise exception 'Cannot cancel after replacement attendance has been logged'; end if;
    -- Change state before restoring ordinary assignments so the approved-leave roster
    -- guard permits the restoration. The function is one transaction, so any later
    -- failure rolls this state change back with every other cancellation mutation.
    update leave_requests set status='cancelled',cancelled_by=(select auth.uid()),cancelled_at=now(),
      cancellation_reason=btrim(p_reason) where id=p_request;
    for d in select lc.* from leave_coverage lc join leave_request_days lrd on lrd.id=lc.request_day_id where lrd.request_id=p_request order by lc.coverage_date,lc.id loop
      delete from schedule_assignments where id=d.replacement_assignment_id and d.replacement_assignment_id is not null;
      delete from shift_logs where assignment_id=d.original_assignment_id;
      update schedule_assignments set shift_type_id=d.shift_type_id, leave_request_day_id=null where id=d.original_assignment_id;
    end loop;
    update leave_coverage set status='cancelled' where request_day_id in (select id from leave_request_days where request_id=p_request);
    if v_req.charged_units > 0 and v_req.leave_type <> 'unpaid' then
      insert into leave_ledger (tenant_id, employee_id, leave_type, entry_type, units, request_id, reference, effective_date, created_by)
      values (v_tenant,v_req.employee_id,v_req.leave_type,'reversal',v_req.charged_units,p_request,'Cancelled leave',current_date,(select auth.uid()));
      if v_req.balance_charged then
        perform private.apply_leave_balance(v_tenant,v_req.employee_id,v_req.leave_type,v_req.charged_units);
      end if;
    end if;
  end if;
  if v_req.status='submitted' then
    update leave_requests set status='cancelled',cancelled_by=(select auth.uid()),cancelled_at=now(),
      cancellation_reason=btrim(p_reason) where id=p_request;
  end if;
end $$;

create or replace function public.unassign_leave_cover(p_coverage uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_tenant uuid:=get_my_tenant_id(); v_cov leave_coverage;
begin
  if (select auth.uid()) is null or get_my_role() not in ('admin','operations','supervisor','payroll') then raise exception 'Not permitted to unassign cover'; end if;
  select * into v_cov from leave_coverage where id=p_coverage and tenant_id=v_tenant for update;
  if not found or v_cov.status<>'assigned' then raise exception 'Assigned coverage not found'; end if;
  if exists(select 1 from shift_logs where assignment_id=v_cov.replacement_assignment_id) then raise exception 'Cannot unassign after attendance has been logged'; end if;
  delete from schedule_assignments where id=v_cov.replacement_assignment_id;
  update leave_coverage set status='open',replacement_employee_id=null,replacement_assignment_id=null,assigned_by=null,assigned_at=null where id=p_coverage;
end $$;

create or replace function public.waive_leave_cover(p_coverage uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_tenant uuid:=get_my_tenant_id();
begin
  if (select auth.uid()) is null or get_my_role() not in ('admin','operations','payroll') then raise exception 'Not permitted to waive coverage'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'A waiver reason is required'; end if;
  update leave_coverage set status='waived',waived_reason=btrim(p_reason),assigned_by=(select auth.uid()),assigned_at=now()
  where id=p_coverage and tenant_id=v_tenant and status='open';
  if not found then raise exception 'Open coverage requirement not found'; end if;
end $$;

create or replace function public.update_leave_policy(
  p_type public.leave_type,p_paid_percent numeric,p_balance_enforced boolean,p_allow_negative boolean,
  p_minimum_notice_days integer,p_evidence_required_after_days numeric,p_maximum_consecutive_days numeric,p_active boolean
) returns void language plpgsql security definer set search_path=public as $$
declare v_tenant uuid:=get_my_tenant_id();
begin
  if (select auth.uid()) is null or get_my_role()<>'admin' then raise exception 'Only admin can update leave policy'; end if;
  if p_type in ('annual','sick','compassionate') and p_paid_percent<>100 then
    raise exception 'Annual, sick and compassionate leave must remain 100%% paid';
  end if;
  if p_type='unpaid' and p_paid_percent<>0 then raise exception 'Unpaid leave must remain 0%% paid'; end if;
  if p_type in ('maternity','unpaid') and (p_balance_enforced or p_allow_negative) then
    raise exception 'Maternity and unpaid leave do not use a day balance';
  end if;
  if p_type in ('sick','compassionate') and p_minimum_notice_days<>0 then
    raise exception 'Sick and compassionate leave cannot require advance notice';
  end if;
  update leave_policies set paid_percent=p_paid_percent,balance_enforced=p_balance_enforced,allow_negative=p_allow_negative,
    minimum_notice_days=p_minimum_notice_days,evidence_required_after_days=p_evidence_required_after_days,
    maximum_consecutive_days=p_maximum_consecutive_days,active=p_active
  where tenant_id=v_tenant and leave_type=p_type;
  if not found then raise exception 'Leave policy not found'; end if;
end $$;

create or replace function public.assign_leave_cover(p_coverage uuid, p_employee uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid:=get_my_tenant_id(); v_role text:=get_my_role(); v_cov leave_coverage; v_assignment uuid;
begin
  if (select auth.uid()) is null or v_role not in ('admin','operations','supervisor','payroll') then raise exception 'Not permitted to assign cover'; end if;
  select * into v_cov from leave_coverage where id=p_coverage and tenant_id=v_tenant for update;
  if not found or v_cov.status <> 'open' then raise exception 'Open coverage requirement not found'; end if;
  if not exists (select 1 from employees where id=p_employee and tenant_id=v_tenant and status='active') then raise exception 'Active replacement employee not found'; end if;
  if p_employee=v_cov.leave_employee_id then raise exception 'The employee on leave cannot cover their own shift'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text, 0));
  if exists (
    select 1 from schedule_assignments sa join shift_types st on st.id=sa.shift_type_id
    where sa.employee_id=p_employee and sa.date=v_cov.coverage_date
      and st.pay_rule not in ('off','leave')
  ) then raise exception 'Replacement employee is already rostered to work that day'; end if;
  if exists (
    select 1 from leave_request_days d join leave_requests r on r.id=d.request_id
    where d.employee_id=p_employee and d.leave_date=v_cov.coverage_date
      and r.status in ('submitted','approved')
  ) then raise exception 'Replacement employee has active leave on this date'; end if;
  if employee_week_hours(p_employee, v_cov.coverage_date) + v_cov.planned_hours > 60
      and not has_ps_exemption(p_employee, v_cov.coverage_date) then
    raise exception 'Relief assignment would exceed the 60-hour weekly cap without a PS exemption';
  end if;
  insert into schedule_assignments (tenant_id,employee_id,site_id,date,shift_type_id,planned_hours,is_replacement,notes,created_by)
  values (v_tenant,p_employee,v_cov.site_id,v_cov.coverage_date,v_cov.shift_type_id,v_cov.planned_hours,true,'Leave cover',(select auth.uid())) returning id into v_assignment;
  update leave_coverage set status='assigned',replacement_employee_id=p_employee,replacement_assignment_id=v_assignment,assigned_by=(select auth.uid()),assigned_at=now() where id=p_coverage;
  return v_assignment;
end $$;

create or replace function public.adjust_leave_balance(p_employee uuid,p_type public.leave_type,p_units numeric,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_tenant uuid:=get_my_tenant_id();
begin
  if (select auth.uid()) is null or get_my_role() not in ('admin','operations','payroll') then raise exception 'Not permitted to adjust leave'; end if;
  if p_type not in ('annual','sick','compassionate') or p_units=0 or coalesce(btrim(p_reason),'')='' then raise exception 'A non-zero balance type and reason are required'; end if;
  if not exists(select 1 from employees where id=p_employee and tenant_id=v_tenant) then raise exception 'Employee not found'; end if;
  insert into leave_ledger(tenant_id,employee_id,leave_type,entry_type,units,reference,effective_date,created_by)
  values(v_tenant,p_employee,p_type,'adjustment',p_units,btrim(p_reason),current_date,(select auth.uid()));
  perform private.apply_leave_balance(v_tenant,p_employee,p_type,p_units);
end $$;

create or replace function private.record_leave_accrual()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.leave_ledger(tenant_id,employee_id,leave_type,entry_type,units,pay_period_id,reference,effective_date,created_by)
  values(new.tenant_id,new.employee_id,'annual','accrual',new.days_accrued,new.pay_period_id,'Payroll accrual',
    coalesce((select p.end_date from public.pay_periods p where p.id=new.pay_period_id),current_date),(select auth.uid()))
  on conflict do nothing;
  return new;
end $$;
create trigger leave_accruals_to_ledger after insert on public.leave_accruals for each row execute function private.record_leave_accrual();

create or replace function private.sync_leave_logs_for_period()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.shift_logs(tenant_id,assignment_id,employee_id,pay_period_id,date,site_id,shift_type_id,hours_worked,night_hours,status,approved_by,approved_at,notes)
  select new.tenant_id,sa.id,r.employee_id,new.id,d.leave_date,sa.site_id,sa.shift_type_id,
    round(sa.planned_hours*r.paid_percent/100.0,2),0,'approved',r.decided_by,r.decided_at,'Approved '||r.leave_type::text||' leave'
  from public.leave_request_days d join public.leave_requests r on r.id=d.request_id
  join public.schedule_assignments sa on sa.leave_request_day_id=d.id
  where r.tenant_id=new.tenant_id and r.status='approved' and d.leave_date between new.start_date and new.end_date
    and not exists(select 1 from public.shift_logs sl where sl.assignment_id=sa.id);
  return new;
end $$;
create trigger pay_period_sync_approved_leave after insert on public.pay_periods for each row execute function private.sync_leave_logs_for_period();

create or replace function private.prevent_roster_on_approved_leave()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.leave_request_day_id is null and exists(
    select 1 from public.leave_request_days d join public.leave_requests r on r.id=d.request_id
    where d.employee_id=new.employee_id and d.leave_date=new.date and r.status='approved'
  ) then raise exception 'Employee is on approved leave on %',new.date using errcode='check_violation'; end if;
  return new;
end $$;
create trigger schedule_assignments_approved_leave_guard before insert or update of employee_id,date,leave_request_day_id
on public.schedule_assignments for each row execute function private.prevent_roster_on_approved_leave();

create trigger leave_requests_audit after insert or update or delete on public.leave_requests for each row execute function public.write_audit_event();
create trigger leave_cycles_audit after insert or update or delete on public.leave_cycles for each row execute function public.write_audit_event();
create trigger leave_ledger_audit after insert or update or delete on public.leave_ledger for each row execute function public.write_audit_event();
create trigger leave_coverage_audit after insert or update or delete on public.leave_coverage for each row execute function public.write_audit_event();

insert into storage.buckets (id,name,public) values ('leave-evidence','leave-evidence',false)
on conflict (id) do nothing;

create policy leave_evidence_insert on storage.objects for insert to authenticated with check (
  bucket_id='leave-evidence'
  and (storage.foldername(name))[1]=(select public.get_my_tenant_id())::text
  and exists(
    select 1 from public.employees e
    where e.id::text=(storage.foldername(name))[2]
      and e.tenant_id=(select public.get_my_tenant_id())
      and (
        (select public.get_my_role()) in ('admin','operations','supervisor','payroll')
        or ((select public.get_my_role())='security_supervisor' and e.home_site_id=any(public.current_site_ids()))
      )
  )
);
create policy leave_evidence_read on storage.objects for select to authenticated using (
  bucket_id='leave-evidence'
  and (storage.foldername(name))[1]=(select public.get_my_tenant_id())::text
  and exists(
    select 1 from public.employees e
    where e.id::text=(storage.foldername(name))[2]
      and e.tenant_id=(select public.get_my_tenant_id())
      and (
        (select public.get_my_role()) in ('admin','operations','supervisor','payroll')
        or ((select public.get_my_role())='security_supervisor' and e.home_site_id=any(public.current_site_ids()))
      )
  )
);
create policy leave_evidence_delete on storage.objects for delete to authenticated using (
  bucket_id='leave-evidence'
  and (storage.foldername(name))[1]=(select public.get_my_tenant_id())::text
  and (owner_id=(select auth.uid())::text or (select public.get_my_role())='admin')
);

-- Persist the leave breakdown alongside the already-computed ordinary-hours total so
-- historical payslips remain reproducible after the underlying roster changes.
create or replace function public.replace_draft_payroll(p_period uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role not in ('payroll','admin') then raise exception 'Not authorized to run payroll'; end if;
  if not exists(select 1 from public.pay_periods where id=p_period and tenant_id=v_tenant and status='open') then
    raise exception 'Open payroll period not found';
  end if;
  delete from public.payroll_runs where pay_period_id=p_period and status='draft' and tenant_id=v_tenant;
  insert into public.payroll_runs (
    tenant_id,employee_id,pay_period_id,normal_hours,overtime_hours,sunday_hours,sunday_callin_hours,
    public_holiday_hours,night_hours,annual_leave_hours,sick_leave_hours,compassionate_leave_hours,maternity_leave_hours,maternity_paid_hours,unpaid_leave_hours,
    rate_per_hour,normal_amount,overtime_amount,sunday_amount,sunday_callin_amount,public_holiday_amount,
    night_premium_amount,transport_allowance,gross_salary,paye_amount,ssc_amount,consensual_deductions,
    total_deductions,net_salary,compliance_warnings,status)
  select v_tenant,(r->>'employee_id')::uuid,p_period,
    coalesce((r->>'normal_hours')::numeric,0),coalesce((r->>'overtime_hours')::numeric,0),
    coalesce((r->>'sunday_hours')::numeric,0),coalesce((r->>'sunday_callin_hours')::numeric,0),
    coalesce((r->>'public_holiday_hours')::numeric,0),coalesce((r->>'night_hours')::numeric,0),
    coalesce((r->>'annual_leave_hours')::numeric,0),coalesce((r->>'sick_leave_hours')::numeric,0),
    coalesce((r->>'compassionate_leave_hours')::numeric,0),coalesce((r->>'maternity_leave_hours')::numeric,0),
    coalesce((r->>'maternity_paid_hours')::numeric,0),
    coalesce((r->>'unpaid_leave_hours')::numeric,0),
    (r->>'rate_per_hour')::numeric,coalesce((r->>'normal_amount')::numeric,0),
    coalesce((r->>'overtime_amount')::numeric,0),coalesce((r->>'sunday_amount')::numeric,0),
    coalesce((r->>'sunday_callin_amount')::numeric,0),coalesce((r->>'public_holiday_amount')::numeric,0),
    coalesce((r->>'night_premium_amount')::numeric,0),coalesce((r->>'transport_allowance')::numeric,0),
    coalesce((r->>'gross_salary')::numeric,0),coalesce((r->>'paye_amount')::numeric,0),
    coalesce((r->>'ssc_amount')::numeric,0),coalesce((r->>'consensual_deductions')::numeric,0),
    coalesce((r->>'total_deductions')::numeric,0),coalesce((r->>'net_salary')::numeric,0),
    coalesce(r->'compliance_warnings','[]'::jsonb),'draft'
  from jsonb_array_elements(p_rows) r;
end $$;

-- Annual leave is a four-week entitlement per 12-month cycle, not a reward that
-- disappears when an employee is legitimately absent. Accrue the statutory cycle
-- entitlement proportionally by calendar days in each pay period.
create or replace function public.finalize_payroll_period(p_period uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_tenant uuid:=get_my_tenant_id(); v_role text:=get_my_role(); v_start date; v_end date; v_employee record;
begin
  if (select auth.uid()) is null or v_tenant is null or v_role not in ('payroll','admin') then
    raise exception 'Not authorized to finalize payroll';
  end if;
  select start_date,end_date into v_start,v_end from pay_periods
  where id=p_period and tenant_id=v_tenant and status='open' for update;
  if not found then raise exception 'Open payroll period not found'; end if;
  if not exists(select 1 from payroll_runs where pay_period_id=p_period and tenant_id=v_tenant and status='draft') then
    raise exception 'Run draft payroll before finalizing the period';
  end if;

  update payroll_runs set status='finalized',finalized_at=now()
  where pay_period_id=p_period and status='draft' and tenant_id=v_tenant;

  for v_employee in select id from employees where tenant_id=v_tenant and status<>'terminated' and category='officer' loop
    perform private.ensure_statutory_leave_cycles(v_tenant,v_employee.id,v_end);
  end loop;

  -- Sum an exact daily fraction of the employee's four-week entitlement. This avoids
  -- leap-year drift and correctly caps a confirmed leaver at the last working day.
  with eligible_employees as (
    select e.id employee_id,least(6,greatest(1,e.days_per_week))::numeric days_per_week,
      coalesce(e.start_date,v_start) employment_start,
      least(v_end,coalesce((
        select max(x.last_working_day) from employment_exits x
        where x.employee_id=e.id and x.tenant_id=v_tenant and x.status='confirmed'
          and (x.final_pay_period_id=p_period or x.last_working_day between v_start and v_end)
      ),v_end)) employment_end
    from employees e
    where e.tenant_id=v_tenant and e.category='officer'
      and coalesce(e.start_date,v_start)<=v_end
      and (e.status<>'terminated' or exists(
        select 1 from employment_exits x where x.employee_id=e.id and x.tenant_id=v_tenant
          and x.status='confirmed' and (x.final_pay_period_id=p_period or x.last_working_day between v_start and v_end)
      ))
  ), daily as (
    select ee.employee_id,ee.days_per_week,
      (ee.employment_start + make_interval(years => extract(year from age(g.day::date,ee.employment_start))::integer))::date cycle_start
    from eligible_employees ee
    cross join lateral generate_series(greatest(v_start,ee.employment_start),ee.employment_end,interval '1 day') g(day)
  ), eligible as (
    select employee_id,round(sum(days_per_week*4 /
      (((cycle_start+interval '1 year')::date-cycle_start)::numeric)),4) days
    from daily group by employee_id
  ), ins as (
    insert into leave_accruals(tenant_id,employee_id,pay_period_id,days_accrued)
    select v_tenant,employee_id,p_period,days from eligible where days>0
    on conflict(employee_id,pay_period_id) do nothing
    returning employee_id,days_accrued
  )
  insert into leave_balances(tenant_id,employee_id,annual_days)
  select v_tenant,employee_id,days_accrued from ins
  on conflict(employee_id) do update set annual_days=leave_balances.annual_days+excluded.annual_days,updated_at=now();

  update pay_periods set status='locked',locked_at=now(),locked_by=(select auth.uid())
  where id=p_period and tenant_id=v_tenant;
end $$;

grant usage on type public.leave_type, public.leave_request_status,
  public.leave_ledger_entry_type, public.leave_coverage_status to authenticated;

revoke all on function private.leave_balance_column(public.leave_type) from public,anon,authenticated;
revoke all on function private.apply_leave_balance(uuid,uuid,public.leave_type,numeric) from public,anon,authenticated;
revoke all on function private.leave_balance_value(uuid,uuid,public.leave_type) from public,anon,authenticated;
revoke all on function private.ensure_statutory_leave_cycles(uuid,uuid,date) from public,anon,authenticated;
revoke all on function private.record_leave_accrual() from public,anon,authenticated;
revoke all on function private.prevent_leave_ledger_mutation() from public,anon,authenticated;
revoke all on function private.sync_leave_logs_for_period() from public,anon,authenticated;
revoke all on function private.prevent_roster_on_approved_leave() from public,anon,authenticated;

revoke all on function public.submit_leave_request(uuid,public.leave_type,date,date,text,text) from public,anon;
revoke all on function public.approve_leave_request(uuid,text) from public,anon;
revoke all on function public.reject_leave_request(uuid,text) from public,anon;
revoke all on function public.cancel_leave_request(uuid,text) from public,anon;
revoke all on function public.assign_leave_cover(uuid,uuid) from public,anon;
revoke all on function public.unassign_leave_cover(uuid) from public,anon;
revoke all on function public.waive_leave_cover(uuid,text) from public,anon;
revoke all on function public.update_leave_policy(public.leave_type,numeric,boolean,boolean,integer,numeric,numeric,boolean) from public,anon;
revoke all on function public.adjust_leave_balance(uuid,public.leave_type,numeric,text) from public,anon;
revoke all on function public.replace_draft_payroll(uuid,jsonb) from public,anon;
revoke all on function public.finalize_payroll_period(uuid) from public,anon;
grant execute on function public.submit_leave_request(uuid,public.leave_type,date,date,text,text) to authenticated;
grant execute on function public.approve_leave_request(uuid,text) to authenticated;
grant execute on function public.reject_leave_request(uuid,text) to authenticated;
grant execute on function public.cancel_leave_request(uuid,text) to authenticated;
grant execute on function public.assign_leave_cover(uuid,uuid) to authenticated;
grant execute on function public.unassign_leave_cover(uuid) to authenticated;
grant execute on function public.waive_leave_cover(uuid,text) to authenticated;
grant execute on function public.update_leave_policy(public.leave_type,numeric,boolean,boolean,integer,numeric,numeric,boolean) to authenticated;
grant execute on function public.adjust_leave_balance(uuid,public.leave_type,numeric,text) to authenticated;
grant execute on function public.replace_draft_payroll(uuid,jsonb) to authenticated;
grant execute on function public.finalize_payroll_period(uuid) to authenticated;
