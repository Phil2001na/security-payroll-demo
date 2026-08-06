import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  tenant: "10000000-0000-0000-0000-000000000001",
  otherTenant: "10000000-0000-0000-0000-000000000002",
  submitter: "20000000-0000-0000-0000-000000000001",
  approver: "20000000-0000-0000-0000-000000000002",
  outsider: "20000000-0000-0000-0000-000000000003",
  securitySupervisor: "20000000-0000-0000-0000-000000000004",
  site: "30000000-0000-0000-0000-000000000001",
  otherSite: "30000000-0000-0000-0000-000000000002",
  unassignedSite: "30000000-0000-0000-0000-000000000003",
  employee: "40000000-0000-0000-0000-000000000001",
  replacement: "40000000-0000-0000-0000-000000000002",
  otherEmployee: "40000000-0000-0000-0000-000000000003",
  recentEmployee: "40000000-0000-0000-0000-000000000004",
  dayShift: "50000000-0000-0000-0000-000000000001",
  period: "60000000-0000-0000-0000-000000000001",
} as const;

const db = new PGlite();

const expectReject = async (description: string, action: () => Promise<unknown>, text: RegExp) => {
  try {
    await action();
    assert.fail(`${description}: expected the database operation to fail`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, text, `${description}: unexpected error`);
  }
};

const scalar = async <T>(sql: string): Promise<T> => {
  const result = await db.query<Record<string, T>>(sql);
  const row = result.rows[0];
  assert.ok(row, `Expected one row for: ${sql}`);
  return Object.values(row)[0] as T;
};

const scalarNumber = async (sql: string): Promise<number> =>
  Number(await scalar<string | number>(sql));

const setActor = async (userId: string) => {
  await db.exec(`
    reset role;
    set "app.user_id" = '${userId}';
    set role authenticated;
  `);
};

const asOwner = async () => {
  await db.exec("reset role; set \"app.user_id\" = '';");
};

const bootstrap = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id',true),'')::uuid
$$;

create table public.tenants (
  id uuid primary key,
  name text not null,
  night_premium_enabled boolean not null default true
);
create table public.profiles (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  role text not null,
  email text
);
create table public.sites (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  name text not null
);
create table public.profile_sites (
  profile_id uuid not null references public.profiles(id),
  site_id uuid not null references public.sites(id),
  primary key(profile_id,site_id)
);
create table public.employees (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  first_names text not null,
  surname text not null,
  employee_code text not null,
  home_site_id uuid references public.sites(id),
  status text not null default 'active',
  category text not null default 'officer',
  start_date date,
  days_per_week numeric not null default 6,
  created_at timestamptz not null default now()
);
create type public.pay_rule as enum (
  'standard','sunday_default','sunday_ordinary','public_holiday','public_holiday_default',
  'public_holiday_ordinary','leave','off'
);
create table public.shift_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  label text not null,
  day_of_week text,
  period text,
  default_hours numeric not null default 12,
  pay_rule public.pay_rule not null default 'standard',
  rate_multiplier numeric not null default 1,
  is_leave boolean not null default false,
  active boolean not null default true,
  unique(tenant_id,code)
);
create table public.schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  employee_id uuid not null references public.employees(id),
  site_id uuid not null references public.sites(id),
  date date not null,
  shift_type_id uuid not null references public.shift_types(id),
  planned_hours numeric not null,
  is_replacement boolean not null default false,
  notes text,
  created_by uuid references public.profiles(id)
);
create table public.pay_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  label text not null default 'Test period',
  start_date date not null,
  end_date date not null,
  pay_date date,
  status text not null default 'open',
  locked_at timestamptz,
  locked_by uuid references public.profiles(id)
);
create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  employee_id uuid not null references public.employees(id),
  pay_period_id uuid not null references public.pay_periods(id),
  normal_hours numeric not null default 0,
  overtime_hours numeric not null default 0,
  sunday_hours numeric not null default 0,
  sunday_callin_hours numeric not null default 0,
  public_holiday_hours numeric not null default 0,
  night_hours numeric not null default 0,
  rate_per_hour numeric not null default 0,
  normal_amount numeric not null default 0,
  overtime_amount numeric not null default 0,
  sunday_amount numeric not null default 0,
  sunday_callin_amount numeric not null default 0,
  public_holiday_amount numeric not null default 0,
  night_premium_amount numeric not null default 0,
  transport_allowance numeric not null default 0,
  gross_salary numeric not null default 0,
  paye_amount numeric not null default 0,
  ssc_amount numeric not null default 0,
  consensual_deductions numeric not null default 0,
  total_deductions numeric not null default 0,
  net_salary numeric not null default 0,
  compliance_warnings jsonb not null default '[]',
  status text not null default 'draft',
  finalized_at timestamptz
);
create table public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  employee_id uuid not null references public.employees(id),
  annual_days numeric not null default 0,
  sick_days numeric not null default 0,
  compassionate_days numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique(employee_id)
);
create table public.leave_accruals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  employee_id uuid not null references public.employees(id),
  pay_period_id uuid not null references public.pay_periods(id),
  days_accrued numeric not null,
  unique(employee_id,pay_period_id)
);
create table public.shift_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  assignment_id uuid not null references public.schedule_assignments(id),
  employee_id uuid not null references public.employees(id),
  pay_period_id uuid not null references public.pay_periods(id),
  date date not null,
  site_id uuid not null references public.sites(id),
  shift_type_id uuid not null references public.shift_types(id),
  hours_worked numeric not null default 0,
  night_hours numeric not null default 0,
  status text not null default 'pending',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  notes text,
  unique(assignment_id)
);
create table public.employment_exits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  employee_id uuid not null references public.employees(id),
  last_working_day date,
  status text not null,
  final_pay_period_id uuid references public.pay_periods(id)
);
create table public.ps_exemptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  effective_from date not null,
  effective_to date not null
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  actor_id uuid,
  table_name text,
  record_id uuid,
  action text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create table storage.buckets (id text primary key,name text not null,public boolean not null default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner_id text
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name,'/')
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;
create or replace function public.get_my_tenant_id() returns uuid language sql stable security definer as $$
  select tenant_id from public.profiles where id=auth.uid()
$$;
create or replace function public.get_my_role() returns text language sql stable security definer as $$
  select role from public.profiles where id=auth.uid()
$$;
create or replace function public.current_site_ids() returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(site_id),'{}'::uuid[]) from public.profile_sites where profile_id=auth.uid()
$$;
create or replace function public.employee_week_hours(p_employee uuid,p_date date) returns numeric
language sql stable security definer as $$
  select coalesce(sum(sa.planned_hours),0) from public.schedule_assignments sa
  join public.shift_types st on st.id=sa.shift_type_id
  where sa.employee_id=p_employee and sa.date between date_trunc('week',p_date)::date and date_trunc('week',p_date)::date+6
    and st.pay_rule not in ('off','leave')
$$;
create or replace function public.has_ps_exemption(p_employee uuid,p_date date) returns boolean
language sql stable security definer as $$
  select exists(select 1 from public.ps_exemptions where employee_id=p_employee and p_date between effective_from and effective_to)
$$;
create or replace function public.write_audit_event() returns trigger language plpgsql security definer as $$
declare payload jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_events(tenant_id,actor_id,table_name,record_id,action,old_values,new_values)
  values((payload->>'tenant_id')::uuid,auth.uid(),tg_table_name,(payload->>'id')::uuid,tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new,old);
end $$;

grant usage on schema public,auth,storage to authenticated;
grant execute on function auth.uid(),public.get_my_tenant_id(),public.get_my_role(),public.current_site_ids() to authenticated;
grant select on public.tenants,public.profiles,public.sites,public.profile_sites,public.employees,
  public.shift_types,public.schedule_assignments,public.pay_periods,public.payroll_runs,
  public.leave_balances,public.leave_accruals,public.shift_logs,public.employment_exits,
  public.ps_exemptions to authenticated;
grant select,insert,delete on storage.objects to authenticated;

insert into public.tenants(id,name) values
  ('${ids.tenant}','Leave test tenant'),('${ids.otherTenant}','Other tenant');
insert into public.sites(id,tenant_id,name) values
  ('${ids.site}','${ids.tenant}','Main site'),
  ('${ids.unassignedSite}','${ids.tenant}','Unassigned site'),
  ('${ids.otherSite}','${ids.otherTenant}','Other site');
insert into public.profiles(id,tenant_id,role,email) values
  ('${ids.submitter}','${ids.tenant}','operations','submitter@test.invalid'),
  ('${ids.approver}','${ids.tenant}','admin','approver@test.invalid'),
  ('${ids.outsider}','${ids.otherTenant}','operations','other@test.invalid'),
  ('${ids.securitySupervisor}','${ids.tenant}','security_supervisor','field@test.invalid');
insert into public.profile_sites(profile_id,site_id) values
  ('${ids.submitter}','${ids.site}'),('${ids.securitySupervisor}','${ids.site}');
insert into public.employees(id,tenant_id,first_names,surname,employee_code,home_site_id,start_date,days_per_week) values
  ('${ids.employee}','${ids.tenant}','Test','Guard','G001','${ids.site}','2025-01-01',5),
  ('${ids.replacement}','${ids.tenant}','Relief','Guard','G002','${ids.site}','2025-01-01',5),
  ('${ids.otherEmployee}','${ids.otherTenant}','Other','Tenant','X001','${ids.otherSite}','2025-01-01',5),
  ('${ids.recentEmployee}','${ids.tenant}','Recent','Starter','G003','${ids.unassignedSite}','2026-06-01',5);
insert into public.leave_balances(tenant_id,employee_id,annual_days,sick_days,compassionate_days) values
  ('${ids.tenant}','${ids.employee}',5,10,2),
  ('${ids.tenant}','${ids.replacement}',0,0,0),
  ('${ids.otherTenant}','${ids.otherEmployee}',0,0,0),
  ('${ids.tenant}','${ids.recentEmployee}',0,0,0);
insert into public.shift_types(id,tenant_id,code,label,day_of_week,period,default_hours,pay_rule) values
  ('${ids.dayShift}','${ids.tenant}','DAY','Day shift','any','day',12,'standard');
`;

try {
  await db.exec(bootstrap);
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260803181750_leave_management_module.sql"),
    "utf8",
  );
  await db.exec(migration);

  assert.equal(
    await scalarNumber(`select sick_days from leave_balances where employee_id='${ids.employee}'`),
    30,
  );
  assert.equal(
    await scalarNumber(
      `select compassionate_days from leave_balances where employee_id='${ids.employee}'`,
    ),
    5,
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from leave_ledger where employee_id='${ids.employee}' and entry_type='opening'`,
    ),
    3,
  );
  await setActor(ids.securitySupervisor);
  await expectReject(
    "security supervisor site scope",
    () =>
      db.exec(
        `select submit_leave_request('${ids.recentEmployee}','annual','2026-08-10','2026-08-10','Outside my site',null)`,
      ),
    /outside your assigned sites/i,
  );
  await db.exec(`
    insert into storage.objects(bucket_id,name,owner_id)
    values('leave-evidence','${ids.tenant}/${ids.employee}/evidence.pdf','${ids.securitySupervisor}');
  `);
  await expectReject(
    "evidence upload outside security supervisor sites",
    () =>
      db.exec(`
        insert into storage.objects(bucket_id,name,owner_id)
        values('leave-evidence','${ids.tenant}/${ids.recentEmployee}/blocked.pdf','${ids.securitySupervisor}')
      `),
    /row-level security policy/i,
  );
  assert.equal(
    await scalarNumber("select count(*) from storage.objects where bucket_id='leave-evidence'"),
    1,
  );
  await setActor(ids.outsider);
  assert.equal(
    await scalarNumber("select count(*) from storage.objects where bucket_id='leave-evidence'"),
    0,
    "Evidence RLS must isolate tenants",
  );

  await asOwner();
  await db.exec(`
    insert into pay_periods(id,tenant_id,label,start_date,end_date,pay_date,status)
    values('${ids.period}','${ids.tenant}','August 2026','2026-08-01','2026-08-31','2026-09-05','open');
    insert into schedule_assignments(tenant_id,employee_id,site_id,date,shift_type_id,planned_hours)
    values
      ('${ids.tenant}','${ids.employee}','${ids.site}','2026-08-10','${ids.dayShift}',12),
      ('${ids.tenant}','${ids.employee}','${ids.site}','2026-08-10','${ids.dayShift}',12);
  `);

  await setActor(ids.submitter);
  const requestId = await scalar<string>(`
    select submit_leave_request('${ids.employee}','annual','2026-08-10','2026-08-11','Family trip',null)
  `);
  await expectReject(
    "self approval",
    () => db.exec(`select approve_leave_request('${requestId}',null)`),
    /requester cannot approve/i,
  );

  await setActor(ids.approver);
  await db.exec(`select approve_leave_request('${requestId}','Coverage required')`);
  assert.equal(
    await scalar<string>(`select status::text from leave_requests where id='${requestId}'`),
    "approved",
  );
  assert.equal(
    await scalarNumber(`select charged_units from leave_requests where id='${requestId}'`),
    1,
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from leave_coverage where request_day_id in (select id from leave_request_days where request_id='${requestId}')`,
    ),
    2,
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from shift_logs where employee_id='${ids.employee}' and date='2026-08-10'`,
    ),
    2,
  );
  assert.equal(
    await scalarNumber(
      `select annual_days from leave_balances where employee_id='${ids.employee}'`,
    ),
    4,
  );

  const coverageId = await scalar<string>(
    `select id from leave_coverage where status='open' order by id limit 1`,
  );
  await db.exec(`select assign_leave_cover('${coverageId}','${ids.replacement}')`);
  assert.equal(
    await scalar<string>(`select status::text from leave_coverage where id='${coverageId}'`),
    "assigned",
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from schedule_assignments where employee_id='${ids.replacement}' and is_replacement`,
    ),
    1,
  );

  await db.exec(`select cancel_leave_request('${requestId}','Trip cancelled')`);
  assert.equal(
    await scalar<string>(`select status::text from leave_requests where id='${requestId}'`),
    "cancelled",
  );
  assert.equal(
    await scalarNumber(
      `select annual_days from leave_balances where employee_id='${ids.employee}'`,
    ),
    5,
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from schedule_assignments where employee_id='${ids.replacement}' and is_replacement`,
    ),
    0,
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from shift_logs where employee_id='${ids.employee}' and date='2026-08-10'`,
    ),
    0,
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from leave_ledger where request_id='${requestId}' and entry_type='reversal'`,
    ),
    1,
  );

  await asOwner();
  await expectReject(
    "immutable leave ledger",
    () => db.exec(`update leave_ledger set reference='tampered' where request_id='${requestId}'`),
    /immutable/i,
  );
  await setActor(ids.approver);
  await expectReject(
    "statutory annual pay floor",
    () => db.exec("select update_leave_policy('annual',50,true,false,0,null,null,true)"),
    /100% paid/i,
  );
  await expectReject(
    "maternity minimum duration",
    () =>
      db.exec(
        `select submit_leave_request('${ids.employee}','maternity','2026-09-01','2026-10-31','Maternity',null)`,
      ),
    /12 consecutive weeks/i,
  );

  // Approval is atomic: no published work is refused, and evidence failure rolls every
  // provisional roster/log/coverage mutation back with the request still submitted.
  await setActor(ids.submitter);
  const noRosterRequest = await scalar<string>(
    `select submit_leave_request('${ids.employee}','annual','2026-08-12','2026-08-12','No roster',null)`,
  );
  await setActor(ids.approver);
  await expectReject(
    "approval without a published roster",
    () => db.exec(`select approve_leave_request('${noRosterRequest}',null)`),
    /Publish the roster/i,
  );
  assert.equal(
    await scalar<string>(`select status::text from leave_requests where id='${noRosterRequest}'`),
    "submitted",
  );
  await setActor(ids.submitter);
  await expectReject(
    "overlapping active request",
    () =>
      db.exec(
        `select submit_leave_request('${ids.employee}','unpaid','2026-08-12','2026-08-13','Overlap',null)`,
      ),
    /overlapping leave request/i,
  );

  await asOwner();
  await db.exec(`
    insert into schedule_assignments(tenant_id,employee_id,site_id,date,shift_type_id,planned_hours)
    values
      ('${ids.tenant}','${ids.employee}','${ids.site}','2026-08-17','${ids.dayShift}',12),
      ('${ids.tenant}','${ids.employee}','${ids.site}','2026-08-18','${ids.dayShift}',12),
      ('${ids.tenant}','${ids.employee}','${ids.site}','2026-08-19','${ids.dayShift}',12);
  `);
  await setActor(ids.submitter);
  const evidenceRequest = await scalar<string>(
    `select submit_leave_request('${ids.employee}','sick','2026-08-17','2026-08-19','Illness',null)`,
  );
  await setActor(ids.approver);
  await expectReject(
    "required evidence",
    () => db.exec(`select approve_leave_request('${evidenceRequest}',null)`),
    /Supporting evidence is required/i,
  );
  assert.equal(
    await scalar<string>(`select status::text from leave_requests where id='${evidenceRequest}'`),
    "submitted",
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from schedule_assignments where employee_id='${ids.employee}' and date between '2026-08-17' and '2026-08-19' and leave_request_day_id is not null`,
    ),
    0,
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from leave_coverage where request_day_id in (select id from leave_request_days where request_id='${evidenceRequest}')`,
    ),
    0,
  );
  assert.equal(
    await scalarNumber(`select sick_days from leave_balances where employee_id='${ids.employee}'`),
    30,
  );

  // A relief guard at 60 rostered hours is blocked until a valid PS exemption exists.
  await asOwner();
  await db.exec(`
    insert into schedule_assignments(tenant_id,employee_id,site_id,date,shift_type_id,planned_hours)
    values
      ('${ids.tenant}','${ids.employee}','${ids.site}','2026-08-24','${ids.dayShift}',12),
      ('${ids.tenant}','${ids.replacement}','${ids.site}','2026-08-25','${ids.dayShift}',12),
      ('${ids.tenant}','${ids.replacement}','${ids.site}','2026-08-26','${ids.dayShift}',12),
      ('${ids.tenant}','${ids.replacement}','${ids.site}','2026-08-27','${ids.dayShift}',12),
      ('${ids.tenant}','${ids.replacement}','${ids.site}','2026-08-28','${ids.dayShift}',12),
      ('${ids.tenant}','${ids.replacement}','${ids.site}','2026-08-29','${ids.dayShift}',12);
  `);
  await setActor(ids.submitter);
  const cappedRequest = await scalar<string>(
    `select submit_leave_request('${ids.employee}','annual','2026-08-24','2026-08-24','Planned leave',null)`,
  );
  await setActor(ids.approver);
  await db.exec(`select approve_leave_request('${cappedRequest}',null)`);
  const cappedCoverage = await scalar<string>(`
    select id from leave_coverage where request_day_id in
      (select id from leave_request_days where request_id='${cappedRequest}')
  `);
  await expectReject(
    "replacement weekly cap",
    () => db.exec(`select assign_leave_cover('${cappedCoverage}','${ids.replacement}')`),
    /60-hour weekly cap/i,
  );
  await asOwner();
  await db.exec(`
    insert into ps_exemptions(employee_id,effective_from,effective_to)
    values('${ids.replacement}','2026-08-24','2026-08-30');
  `);
  await setActor(ids.approver);
  await db.exec(`select assign_leave_cover('${cappedCoverage}','${ids.replacement}')`);
  const replacementAssignment = await scalar<string>(
    `select replacement_assignment_id from leave_coverage where id='${cappedCoverage}'`,
  );
  await asOwner();
  await db.exec(`
    insert into shift_logs(tenant_id,assignment_id,employee_id,pay_period_id,date,site_id,shift_type_id,hours_worked,status)
    values('${ids.tenant}','${replacementAssignment}','${ids.replacement}','${ids.period}','2026-08-24','${ids.site}','${ids.dayShift}',12,'approved');
  `);
  await setActor(ids.approver);
  await expectReject(
    "unassign after relief attendance",
    () => db.exec(`select unassign_leave_cover('${cappedCoverage}')`),
    /attendance has been logged/i,
  );

  // Persist the leave breakdown and finalize. The embedded PostgreSQL execution proves
  // the PL/pgSQL body, trigger chain, exact annual accrual and period lock work together.
  await db.exec(`
    select replace_draft_payroll('${ids.period}',jsonb_build_array(jsonb_build_object(
      'employee_id','${ids.employee}','normal_hours',54,'maternity_leave_hours',12,
      'maternity_paid_hours',6,'unpaid_leave_hours',12,'rate_per_hour',20,
      'normal_amount',1080,'gross_salary',1080,'net_salary',1080,
      'compliance_warnings',jsonb_build_array()
    )));
  `);
  assert.equal(
    await scalarNumber(
      `select maternity_paid_hours from payroll_runs where pay_period_id='${ids.period}'`,
    ),
    6,
  );
  await db.exec(`select finalize_payroll_period('${ids.period}')`);
  assert.equal(
    await scalar<string>(`select status from pay_periods where id='${ids.period}'`),
    "locked",
  );
  assert.ok(
    (await scalarNumber(
      `select days_accrued from leave_accruals where employee_id='${ids.employee}' and pay_period_id='${ids.period}'`,
    )) > 1.6,
  );
  assert.equal(
    await scalarNumber(
      `select count(*) from leave_ledger where employee_id='${ids.employee}' and pay_period_id='${ids.period}' and entry_type='accrual'`,
    ),
    1,
  );
  await expectReject(
    "cancellation after payroll lock",
    () => db.exec(`select cancel_leave_request('${cappedRequest}','Too late')`),
    /locked payroll period/i,
  );

  await asOwner();
  await db.exec(`
    insert into schedule_assignments(tenant_id,employee_id,site_id,date,shift_type_id,planned_hours)
    values
      ('${ids.tenant}','${ids.employee}','${ids.site}','2026-08-30','${ids.dayShift}',12),
      ('${ids.tenant}','${ids.recentEmployee}','${ids.unassignedSite}','2026-09-01','${ids.dayShift}',12);
  `);
  await setActor(ids.submitter);
  const lockedRequest = await scalar<string>(
    `select submit_leave_request('${ids.employee}','annual','2026-08-30','2026-08-30','Late request',null)`,
  );
  await setActor(ids.approver);
  await expectReject(
    "approval in locked payroll",
    () => db.exec(`select approve_leave_request('${lockedRequest}',null)`),
    /locked payroll period/i,
  );

  await setActor(ids.submitter);
  const earlyMaternity = await scalar<string>(
    `select submit_leave_request('${ids.recentEmployee}','maternity','2026-09-01','2026-11-23','Maternity',null)`,
  );
  await setActor(ids.approver);
  await expectReject(
    "maternity service threshold",
    () => db.exec(`select approve_leave_request('${earlyMaternity}',null)`),
    /six months of continuous service/i,
  );

  await setActor(ids.outsider);
  assert.equal(
    await scalarNumber("select count(*) from leave_requests"),
    0,
    "RLS must isolate tenants",
  );
  await expectReject(
    "direct leave table write",
    () => db.exec(`delete from leave_requests where id='${requestId}'`),
    /(permission denied|policy)/i,
  );

  console.log("Leave migration database integration verification passed");
} finally {
  await db.close();
}
