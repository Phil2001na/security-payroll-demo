-- UAT-10: whenever the scheduler can't fill required coverage with compliant guards, the
-- gap must be recorded (not hidden by overworking someone) so Operations/HR can see it and
-- recruit or arrange coverage. Also completes UAT-08's "state the staffing gap and failed
-- eligibility rules" requirement — buildFillPlan() already computes required/have/short per
-- slot client-side; this table is where that becomes a persistent, reportable record instead
-- of a toast that disappears.
create table public.schedule_shortages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  shortage_date date not null,
  shift_kind text not null check (shift_kind in ('day', 'night')),
  required_count integer not null check (required_count > 0),
  unmet_count integer not null check (unmet_count > 0 and unmet_count <= required_count),
  -- One entry per active employee who was considered and excluded: {employee_id, employee_name, reason}.
  failed_eligibility jsonb not null default '[]'::jsonb,
  attempted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index schedule_shortages_tenant_site_date_idx
  on public.schedule_shortages (tenant_id, site_id, shortage_date);

alter table public.schedule_shortages enable row level security;

-- Same read scope as leave_coverage: everyone who can manage rostering, plus a
-- security_supervisor limited to their own assigned sites.
create policy schedule_shortages_read on public.schedule_shortages for select to authenticated using (
  tenant_id = (select public.get_my_tenant_id()) and (
    (select public.get_my_role()) in ('admin', 'operations', 'supervisor', 'payroll')
    or ((select public.get_my_role()) = 'security_supervisor' and site_id = any (public.current_site_ids()))
  )
);

-- Written directly by the scheduler UI (same as schedule_assignments itself), restricted to
-- the roles that can already reach the Schedule page (see app-shell.tsx nav roles).
create policy schedule_shortages_insert on public.schedule_shortages for insert to authenticated with check (
  tenant_id = (select public.get_my_tenant_id())
  and (select public.get_my_role()) in ('admin', 'operations', 'supervisor', 'payroll')
);

grant select, insert on public.schedule_shortages to authenticated;
