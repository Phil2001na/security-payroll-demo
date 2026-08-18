-- ============================================================================
-- SCHEMA BASELINE — generated from the LIVE Supabase project nakvdkkezgdqxytygtqp
-- on 2026-07-05, because the live database has diverged from the migrations in
-- this repo (base schema was built directly on the project).
--
-- Purpose: disaster-recovery reference + the missing "migration zero". Covers
-- the security-payroll app objects in `public` (enums, tables, constraints,
-- indexes, functions, triggers, RLS policies). Excludes the unrelated *_yango
-- tables that share the project, and excludes data / auth config / storage.
--
-- To rebuild from scratch: run this file top to bottom on an empty public
-- schema, then `alter table ... enable row level security` on every table
-- (the live project also has an rls_auto_enable event trigger doing this),
-- then apply any migrations in supabase/migrations dated AFTER 2026-07-05.
-- ============================================================================

-- ------------------------------------------------------------------
-- 1. ENUMS
-- ------------------------------------------------------------------
create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.day_of_week as enum ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'any');
create type public.deduction_category as enum ('statutory', 'recurring', 'offence_fine', 'offence_suspension', 'loan', 'other');
create type public.disciplinary_action_type as enum ('verbal_warning', 'written_warning', 'final_warning', 'unpaid_suspension', 'fine_with_ca', 'dismissal');
create type public.employee_category as enum ('officer', 'management');
create type public.employee_position as enum ('security_officer', 'supervisor', 'site_manager', 'operations_manager', 'admin', 'other', 'driver');
create type public.employee_status as enum ('active', 'suspended', 'terminated');
create type public.installment_status as enum ('active', 'paid_off', 'paused', 'written_off');
create type public.invoice_status as enum ('draft', 'issued', 'paid', 'void');
create type public.invoice_type as enum ('AR', 'AP');
create type public.normal_balance_type as enum ('debit', 'credit');
create type public.pay_period_status as enum ('open', 'locked', 'paid');
create type public.pay_rule as enum ('standard', 'sunday_default', 'sunday_ordinary', 'public_holiday_ordinary', 'public_holiday_non_ordinary', 'leave', 'off');
create type public.payroll_run_status as enum ('draft', 'finalized', 'paid');
create type public.shift_kind as enum ('day', 'night');
create type public.shift_log_status as enum ('pending', 'approved', 'no_show', 'replaced_by_other', 'suspended_unpaid', 'submitted');
create type public.shift_period as enum ('morning', 'day', 'night', 'full_day');
create type public.shift_preference as enum ('day', 'night', 'both');
create type public.app_role as enum ('admin', 'accountant', 'operations', 'supervisor', 'viewer', 'payroll', 'security_supervisor');
create type public.literacy_grade as enum ('A+', 'A', 'B', 'C', 'D');

-- ------------------------------------------------------------------
-- 2. TABLES
-- ------------------------------------------------------------------
create table public.tenants (
  id uuid default gen_random_uuid() not null,
  name text not null,
  legal_name text,
  sesorb_registration_number text,
  s17_3_exemption_document_url text,
  s17_3_exemption_reference text,
  default_hourly_rate numeric default 16.00 not null,
  default_transport_allowance numeric default 350.00 not null,
  pay_period_start_day smallint default 21 not null,
  pay_date_day smallint default 16 not null,
  default_contract_terms text,
  contract_template_officer text,
  contract_template_driver text,
  contract_template_management text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  registered_address text,
  vat_number text,
  company_phone text,
  company_email text,
  company_website text,
  logo_url text,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  bank_branch_name text,
  bank_branch_code text,
  default_tax_rate numeric(5,4) default 0.15 not null,
  invoice_due_days integer default 7 not null,
  invoice_penalty_note text,
  invoice_footer_note text,
  night_premium_enabled boolean default true not null
);

create table public.profiles (
  id uuid not null,
  tenant_id uuid not null,
  full_name text default ''::text not null,
  email text,
  role app_role default 'viewer'::app_role not null,
  assigned_site_ids uuid[] default '{}'::uuid[] not null,
  is_active boolean default true not null,
  is_ceo_executive boolean default false not null,
  onboarding_complete boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.clients (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  name text not null,
  contact_person text,
  email text,
  phone text,
  address text,
  vat_number text,
  payment_terms_days integer,
  notes text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.sites (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  name text not null,
  code text,
  address text,
  client_name text,
  default_shifts jsonb default '[]'::jsonb not null,
  notes text,
  active boolean default true not null,
  contract_terms_text text,
  billing_rate numeric default 0 not null,
  client_contact_email text,
  client_address text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  client_id uuid,
  required_guard_grade literacy_grade
);

create table public.employees (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_code text not null,
  surname text not null,
  first_names text not null,
  display_name text,
  national_id text,
  sesorb_registration_number text,
  "position" employee_position default 'security_officer'::employee_position not null,
  category employee_category default 'officer'::employee_category not null,
  start_date date,
  bank_name text,
  bank_account_number text,
  phone text,
  email text,
  hourly_rate numeric default 16.00 not null,
  transport_allowance numeric default 350.00 not null,
  union_member boolean default false not null,
  ordinarily_works_sundays boolean default false not null,
  sunday_agreement_url text,
  home_site_id uuid,
  status employee_status default 'active'::employee_status not null,
  photo_url text,
  preferred_shift shift_preference default 'both'::shift_preference not null,
  monthly_salary numeric default 0 not null,
  contract_signed_at timestamp with time zone,
  contract_signed_pdf_url text,
  contract_template_kind text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  literacy_grade literacy_grade,
  days_per_week numeric(3,1) default 6 not null
);

create table public.shift_types (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  label text not null,
  day_of_week day_of_week default 'any'::day_of_week not null,
  period shift_period default 'full_day'::shift_period not null,
  default_hours numeric default 12 not null,
  pay_rule pay_rule default 'standard'::pay_rule not null,
  rate_multiplier numeric default 1.0 not null,
  is_premium boolean default false not null,
  is_leave boolean default false not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  start_min smallint,
  end_min smallint
);

create table public.pay_periods (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  label text not null,
  start_date date not null,
  end_date date not null,
  pay_date date not null,
  status pay_period_status default 'open'::pay_period_status not null,
  locked_at timestamp with time zone,
  locked_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.schedule_assignments (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_id uuid not null,
  site_id uuid not null,
  date date not null,
  shift_type_id uuid not null,
  planned_hours numeric not null,
  is_replacement boolean default false not null,
  replaced_assignment_id uuid,
  notes text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.shift_logs (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  assignment_id uuid,
  employee_id uuid not null,
  pay_period_id uuid not null,
  date date not null,
  site_id uuid not null,
  shift_type_id uuid not null,
  hours_worked numeric default 0 not null,
  night_hours numeric default 0 not null,
  status shift_log_status default 'pending'::shift_log_status not null,
  approved_by uuid,
  approved_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.attendance_logs (
  id uuid,
  tenant_id uuid,
  employee_id uuid,
  site_id uuid,
  shift_type_id uuid,
  pay_period_id uuid,
  assignment_id uuid,
  date date,
  hours_worked numeric,
  night_hours numeric,
  status shift_log_status,
  approved_by uuid,
  approved_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
);

create table public.site_requirements (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  site_id uuid not null,
  day_of_week smallint not null,
  shift_kind shift_kind not null,
  quantity_required integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  shift_type_id uuid
);

create table public.public_holidays (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  date date not null,
  name text not null,
  created_at timestamp with time zone default now() not null
);

create table public.payroll_constants (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  key text not null,
  value numeric not null,
  description text,
  effective_from date default CURRENT_DATE not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.paye_brackets (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  lower_bound numeric not null,
  upper_bound numeric,
  base_tax numeric default 0 not null,
  marginal_rate numeric not null,
  effective_from date default CURRENT_DATE not null,
  created_at timestamp with time zone default now() not null
);

create table public.payroll_runs (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_id uuid not null,
  pay_period_id uuid not null,
  normal_hours numeric default 0 not null,
  sunday_hours numeric default 0 not null,
  public_holiday_hours numeric default 0 not null,
  overtime_hours numeric default 0 not null,
  night_hours numeric default 0 not null,
  rate_per_hour numeric not null,
  normal_amount numeric default 0 not null,
  sunday_amount numeric default 0 not null,
  public_holiday_amount numeric default 0 not null,
  overtime_amount numeric default 0 not null,
  night_premium_amount numeric default 0 not null,
  transport_allowance numeric default 0 not null,
  gross_salary numeric default 0 not null,
  ssc_amount numeric default 0 not null,
  paye_amount numeric default 0 not null,
  other_statutory numeric default 0 not null,
  consensual_deductions numeric default 0 not null,
  total_deductions numeric default 0 not null,
  net_salary numeric default 0 not null,
  compliance_warnings jsonb default '[]'::jsonb not null,
  leave_balances_snapshot jsonb,
  status payroll_run_status default 'draft'::payroll_run_status not null,
  generated_at timestamp with time zone default now() not null,
  finalized_at timestamp with time zone,
  paid_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.deduction_types (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  label text not null,
  category deduction_category not null,
  default_amount numeric default 0 not null,
  is_percentage boolean default false not null,
  percentage numeric,
  requires_evidence boolean default false not null,
  requires_collective_agreement boolean default false not null,
  active boolean default true not null,
  note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.deductions (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_id uuid not null,
  pay_period_id uuid not null,
  deduction_type_id uuid not null,
  amount numeric not null,
  incident_date date,
  incident_site_id uuid,
  note text,
  evidence_url text,
  installment_plan_id uuid,
  disciplinary_action_id uuid,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.disciplinary_actions (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_id uuid not null,
  action_type disciplinary_action_type not null,
  offence_code text not null,
  incident_date date not null,
  incident_site_id uuid,
  description text not null,
  evidence_url text,
  suspension_hours numeric default 0,
  suspension_pay_period_id uuid,
  fine_amount numeric default 0,
  collective_agreement_reference text,
  collective_agreement_url text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.installment_plans (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_id uuid not null,
  deduction_type_id uuid not null,
  purpose text not null,
  total_amount numeric not null,
  monthly_amount numeric not null,
  start_period_id uuid,
  end_period_id uuid,
  balance_remaining numeric not null,
  status installment_status default 'active'::installment_status not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.leave_balances (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_id uuid not null,
  annual_days numeric default 0 not null,
  sick_days numeric default 0 not null,
  compassionate_days numeric default 0 not null,
  off_days numeric default 0 not null,
  updated_at timestamp with time zone default now() not null
);

create table public.leave_accruals (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_id uuid not null,
  pay_period_id uuid not null,
  days_accrued numeric(6,4) default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table public.ps_exemptions (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_id uuid not null,
  effective_from date not null,
  effective_to date not null,
  reference text not null,
  document_url text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.signed_agreements (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  employee_id uuid not null,
  site_id uuid,
  contract_snapshot text not null,
  signature_url text not null,
  id_document_url text not null,
  signed_at timestamp with time zone default now() not null,
  signed_ip text,
  signed_by_supervisor uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.vendors (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  name text not null,
  contact_email text,
  phone text,
  address text,
  vat_number text,
  notes text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.service_items (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  name text not null,
  description text,
  unit text default 'hour'::text not null,
  default_rate numeric default 0 not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.invoices (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  type invoice_type not null,
  status invoice_status default 'draft'::invoice_status not null,
  client_id uuid,
  total numeric not null,
  tax numeric default 0 not null,
  due_date date not null,
  issued_at timestamp with time zone,
  paid_at timestamp with time zone,
  invoice_number text,
  pay_period_id uuid,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  vendor_id uuid,
  invoice_date date default CURRENT_DATE not null,
  site_id uuid,
  receipt_url text
);

create table public.invoice_items (
  id uuid default gen_random_uuid() not null,
  invoice_id uuid not null,
  description text not null,
  quantity numeric not null,
  unit_price numeric not null,
  created_at timestamp with time zone default now() not null,
  tax_rate numeric(5,4) default 0.15 not null
);

create table public.chart_of_accounts (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  name text not null,
  type account_type not null,
  code character(4) not null,
  normal_balance normal_balance_type not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.ledger_entries (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  entry_date date not null,
  description text not null,
  reference_id uuid,
  reference_type text,
  created_at timestamp with time zone default now() not null
);

create table public.ledger_lines (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  ledger_id uuid not null,
  account_id uuid not null,
  debit numeric default 0 not null,
  credit numeric default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table public.audit_events (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  actor_id uuid,
  actor_email text,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  notes text,
  created_at timestamp with time zone default now() not null
);

create table public.ai_conversation_sessions (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  owner_user_id uuid not null,
  title text,
  status text default 'active'::text not null,
  purpose text default 'executive_read_only'::text not null,
  model_provider text default 'anthropic'::text not null,
  model_name text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  last_message_at timestamp with time zone
);

create table public.ai_conversation_messages (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  session_id uuid not null,
  actor_user_id uuid,
  role text not null,
  content text not null,
  content_summary text,
  data_sources jsonb default '[]'::jsonb not null,
  retrieval_snapshot jsonb default '{}'::jsonb not null,
  token_usage jsonb default '{}'::jsonb not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.ai_audit_events (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  user_id uuid not null,
  session_id uuid,
  message_id uuid,
  event_type text not null,
  prompt_hash text not null,
  prompt_preview text,
  response_hash text,
  model_provider text default 'anthropic'::text not null,
  model_name text,
  data_sources jsonb default '[]'::jsonb not null,
  retrieval_plan jsonb default '{}'::jsonb not null,
  rows_examined integer default 0 not null,
  token_usage jsonb default '{}'::jsonb not null,
  read_only boolean default true not null,
  request_metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.ai_executive_memories (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  executive_user_id uuid not null,
  memory_type text not null,
  label text not null,
  content text not null,
  source text default 'manual'::text not null,
  source_message_id uuid,
  confidence numeric default 1.000 not null,
  sensitivity text default 'internal'::text not null,
  status text default 'active'::text not null,
  metadata jsonb default '{}'::jsonb not null,
  last_used_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- ------------------------------------------------------------------
-- 3. CONSTRAINTS (PK / UNIQUE / FK / CHECK)
-- ------------------------------------------------------------------
alter table public.ai_audit_events add constraint ai_audit_events_pkey PRIMARY KEY (id);
alter table public.ai_audit_events add constraint ai_audit_events_message_id_fkey FOREIGN KEY (message_id) REFERENCES ai_conversation_messages(id);
alter table public.ai_audit_events add constraint ai_audit_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES ai_conversation_sessions(id);
alter table public.ai_audit_events add constraint ai_audit_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.ai_conversation_messages add constraint ai_conversation_messages_pkey PRIMARY KEY (id);
alter table public.ai_conversation_messages add constraint ai_conversation_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES ai_conversation_sessions(id);
alter table public.ai_conversation_messages add constraint ai_conversation_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.ai_conversation_sessions add constraint ai_conversation_sessions_pkey PRIMARY KEY (id);
alter table public.ai_conversation_sessions add constraint ai_conversation_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.ai_executive_memories add constraint ai_executive_memories_pkey PRIMARY KEY (id);
alter table public.ai_executive_memories add constraint ai_executive_memories_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES ai_conversation_messages(id);
alter table public.ai_executive_memories add constraint ai_executive_memories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.audit_events add constraint audit_events_pkey PRIMARY KEY (id);
alter table public.chart_of_accounts add constraint chart_of_accounts_tenant_code_key UNIQUE (tenant_id, code);
alter table public.chart_of_accounts add constraint chart_of_accounts_pkey PRIMARY KEY (id);
alter table public.chart_of_accounts add constraint chart_of_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.clients add constraint clients_pkey PRIMARY KEY (id);
alter table public.clients add constraint clients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.deduction_types add constraint deduction_types_pkey PRIMARY KEY (id);
alter table public.deduction_types add constraint deduction_types_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.deductions add constraint deductions_pkey PRIMARY KEY (id);
alter table public.deductions add constraint deductions_deduction_type_id_fkey FOREIGN KEY (deduction_type_id) REFERENCES deduction_types(id);
alter table public.deductions add constraint deductions_disciplinary_action_id_fkey FOREIGN KEY (disciplinary_action_id) REFERENCES disciplinary_actions(id);
alter table public.deductions add constraint deductions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.deductions add constraint deductions_incident_site_id_fkey FOREIGN KEY (incident_site_id) REFERENCES sites(id);
alter table public.deductions add constraint deductions_installment_plan_id_fkey FOREIGN KEY (installment_plan_id) REFERENCES installment_plans(id);
alter table public.deductions add constraint deductions_pay_period_id_fkey FOREIGN KEY (pay_period_id) REFERENCES pay_periods(id);
alter table public.deductions add constraint deductions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.disciplinary_actions add constraint disciplinary_actions_pkey PRIMARY KEY (id);
alter table public.disciplinary_actions add constraint disciplinary_actions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.disciplinary_actions add constraint disciplinary_actions_incident_site_id_fkey FOREIGN KEY (incident_site_id) REFERENCES sites(id);
alter table public.disciplinary_actions add constraint disciplinary_actions_suspension_pay_period_id_fkey FOREIGN KEY (suspension_pay_period_id) REFERENCES pay_periods(id);
alter table public.disciplinary_actions add constraint disciplinary_actions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.employees add constraint employees_pkey PRIMARY KEY (id);
alter table public.employees add constraint employees_home_site_id_fkey FOREIGN KEY (home_site_id) REFERENCES sites(id);
alter table public.employees add constraint employees_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.installment_plans add constraint installment_plans_pkey PRIMARY KEY (id);
alter table public.installment_plans add constraint installment_plans_deduction_type_id_fkey FOREIGN KEY (deduction_type_id) REFERENCES deduction_types(id);
alter table public.installment_plans add constraint installment_plans_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.installment_plans add constraint installment_plans_end_period_id_fkey FOREIGN KEY (end_period_id) REFERENCES pay_periods(id);
alter table public.installment_plans add constraint installment_plans_start_period_id_fkey FOREIGN KEY (start_period_id) REFERENCES pay_periods(id);
alter table public.installment_plans add constraint installment_plans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.invoice_items add constraint invoice_items_pkey PRIMARY KEY (id);
alter table public.invoice_items add constraint invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);
alter table public.invoices add constraint invoices_pkey PRIMARY KEY (id);
alter table public.invoices add constraint invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
alter table public.invoices add constraint invoices_pay_period_id_fkey FOREIGN KEY (pay_period_id) REFERENCES pay_periods(id);
alter table public.invoices add constraint invoices_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id);
alter table public.invoices add constraint invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.invoices add constraint invoices_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT;
alter table public.invoices add constraint chk_invoice_party CHECK ((((type = 'AR'::invoice_type) AND (client_id IS NOT NULL)) OR ((type = 'AP'::invoice_type) AND (vendor_id IS NOT NULL))));
alter table public.leave_accruals add constraint leave_accruals_employee_id_pay_period_id_key UNIQUE (employee_id, pay_period_id);
alter table public.leave_accruals add constraint leave_accruals_pkey PRIMARY KEY (id);
alter table public.leave_accruals add constraint leave_accruals_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table public.leave_accruals add constraint leave_accruals_pay_period_id_fkey FOREIGN KEY (pay_period_id) REFERENCES pay_periods(id) ON DELETE CASCADE;
alter table public.leave_accruals add constraint leave_accruals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
alter table public.leave_balances add constraint leave_balances_employee_id_key UNIQUE (employee_id);
alter table public.leave_balances add constraint leave_balances_pkey PRIMARY KEY (id);
alter table public.leave_balances add constraint leave_balances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.leave_balances add constraint leave_balances_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.ledger_entries add constraint ledger_entries_pkey PRIMARY KEY (id);
alter table public.ledger_entries add constraint ledger_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.ledger_lines add constraint ledger_lines_pkey PRIMARY KEY (id);
alter table public.ledger_lines add constraint ledger_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id);
alter table public.ledger_lines add constraint ledger_lines_ledger_id_fkey FOREIGN KEY (ledger_id) REFERENCES ledger_entries(id);
alter table public.ledger_lines add constraint ledger_lines_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.pay_periods add constraint pay_periods_pkey PRIMARY KEY (id);
alter table public.pay_periods add constraint pay_periods_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.paye_brackets add constraint paye_brackets_pkey PRIMARY KEY (id);
alter table public.paye_brackets add constraint paye_brackets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.payroll_constants add constraint payroll_constants_pkey PRIMARY KEY (id);
alter table public.payroll_constants add constraint payroll_constants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.payroll_runs add constraint payroll_runs_pkey PRIMARY KEY (id);
alter table public.payroll_runs add constraint payroll_runs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.payroll_runs add constraint payroll_runs_pay_period_id_fkey FOREIGN KEY (pay_period_id) REFERENCES pay_periods(id);
alter table public.payroll_runs add constraint payroll_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.payroll_runs add constraint chk_payroll_net CHECK ((net_salary = (gross_salary - total_deductions))) NOT VALID;
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
alter table public.ps_exemptions add constraint ps_exemptions_pkey PRIMARY KEY (id);
alter table public.ps_exemptions add constraint ps_exemptions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.ps_exemptions add constraint ps_exemptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.public_holidays add constraint public_holidays_pkey PRIMARY KEY (id);
alter table public.public_holidays add constraint public_holidays_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.schedule_assignments add constraint schedule_assignments_pkey PRIMARY KEY (id);
alter table public.schedule_assignments add constraint schedule_assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.schedule_assignments add constraint schedule_assignments_replaced_assignment_id_fkey FOREIGN KEY (replaced_assignment_id) REFERENCES schedule_assignments(id);
alter table public.schedule_assignments add constraint schedule_assignments_shift_type_id_fkey FOREIGN KEY (shift_type_id) REFERENCES shift_types(id);
alter table public.schedule_assignments add constraint schedule_assignments_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id);
alter table public.schedule_assignments add constraint schedule_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.schedule_assignments add constraint schedule_assignments_max_daily_hours CHECK ((planned_hours <= (12)::numeric));
alter table public.service_items add constraint service_items_pkey PRIMARY KEY (id);
alter table public.service_items add constraint service_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.shift_logs add constraint shift_logs_pkey PRIMARY KEY (id);
alter table public.shift_logs add constraint shift_logs_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES schedule_assignments(id);
alter table public.shift_logs add constraint shift_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.shift_logs add constraint shift_logs_pay_period_id_fkey FOREIGN KEY (pay_period_id) REFERENCES pay_periods(id);
alter table public.shift_logs add constraint shift_logs_shift_type_id_fkey FOREIGN KEY (shift_type_id) REFERENCES shift_types(id);
alter table public.shift_logs add constraint shift_logs_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id);
alter table public.shift_logs add constraint shift_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.shift_types add constraint shift_types_pkey PRIMARY KEY (id);
alter table public.shift_types add constraint shift_types_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.shift_types add constraint shift_types_max_daily_hours CHECK ((is_leave OR (default_hours <= (12)::numeric)));
alter table public.signed_agreements add constraint signed_agreements_pkey PRIMARY KEY (id);
alter table public.signed_agreements add constraint signed_agreements_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
alter table public.signed_agreements add constraint signed_agreements_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id);
alter table public.signed_agreements add constraint signed_agreements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.site_requirements add constraint site_requirements_site_day_kind_key UNIQUE (site_id, day_of_week, shift_kind);
alter table public.site_requirements add constraint site_requirements_pkey PRIMARY KEY (id);
alter table public.site_requirements add constraint site_requirements_shift_type_id_fkey FOREIGN KEY (shift_type_id) REFERENCES shift_types(id) ON DELETE SET NULL;
alter table public.site_requirements add constraint site_requirements_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id);
alter table public.site_requirements add constraint site_requirements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.sites add constraint sites_pkey PRIMARY KEY (id);
alter table public.sites add constraint sites_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
alter table public.sites add constraint sites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
alter table public.tenants add constraint tenants_pkey PRIMARY KEY (id);
alter table public.vendors add constraint vendors_pkey PRIMARY KEY (id);
alter table public.vendors add constraint vendors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ------------------------------------------------------------------
-- 4. INDEXES (non-constraint)
-- ------------------------------------------------------------------
CREATE UNIQUE INDEX clients_tenant_name_uniq ON public.clients USING btree (tenant_id, lower(name));
CREATE INDEX idx_leave_accruals_tenant ON public.leave_accruals USING btree (tenant_id);
CREATE INDEX idx_profiles_tenant ON public.profiles USING btree (tenant_id);
CREATE INDEX idx_vendors_tenant ON public.vendors USING btree (tenant_id);

-- ------------------------------------------------------------------
-- 5. TRIGGERS (functions defined in section 6)
-- NOTE: handle_new_user is wired to auth.users:
--   create trigger on_auth_user_created after insert on auth.users
--   for each row execute function public.handle_new_user();
-- ------------------------------------------------------------------
CREATE TRIGGER clients_touch_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_recalc_invoice_total AFTER INSERT OR DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION fn_recalc_invoice_total();
CREATE TRIGGER trg_assign_invoice_number BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION fn_assign_invoice_number();
CREATE TRIGGER trg_invoices_touch BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_post_invoice_to_ledger AFTER INSERT OR UPDATE OF status ON public.invoices FOR EACH ROW EXECUTE FUNCTION fn_post_invoice_to_ledger();
CREATE CONSTRAINT TRIGGER trg_check_ledger_balance AFTER INSERT OR DELETE OR UPDATE ON public.ledger_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_check_ledger_balance();
CREATE TRIGGER trg_post_payroll_to_ledger AFTER UPDATE OF status ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION fn_post_payroll_to_ledger();
CREATE TRIGGER trg_guard_profile_privileged BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_privileged_columns();
CREATE TRIGGER service_items_touch_updated_at BEFORE UPDATE ON public.service_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_tenants_touch BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_vendors_touch BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ------------------------------------------------------------------
-- 6. FUNCTIONS
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role::text from profiles where id = auth.uid() and is_active;
$function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or public.get_my_role() = 'admin' then
    return new;
  end if;

  if (new.role is distinct from old.role
      or new.is_ceo_executive is distinct from old.is_ceo_executive
      or new.is_active is distinct from old.is_active
      or new.tenant_id is distinct from old.tenant_id) then
    if old.onboarding_complete then
      raise exception 'Not allowed to change role or account status';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_tenant_id  uuid;
  company_name   text;
  invited_tenant uuid;
  invited_role   text;
BEGIN
  -- Admin-invited user: attach to the existing tenant, do NOT create a company.
  invited_tenant := NULLIF(trim(NEW.raw_user_meta_data->>'invited_tenant_id'), '')::uuid;
  IF invited_tenant IS NOT NULL THEN
    invited_role := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'invited_role'), ''), 'viewer');
    INSERT INTO public.profiles (id, tenant_id, full_name, email, role, is_active)
    VALUES (
      NEW.id,
      invited_tenant,
      COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1)),
      NEW.email,
      invited_role::app_role,
      true
    );
    RETURN NEW;
  END IF;

  -- Self-signup (no invite): provision a brand-new tenant and make the user its admin.
  company_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'company_name'), ''),
    initcap(replace(split_part(split_part(NEW.email, '@', 2), '.', 1), '-', ' ')) || ' Security'
  );

  INSERT INTO public.tenants (name, company_email)
  VALUES (company_name, NEW.email)
  RETURNING id INTO new_tenant_id;

  INSERT INTO public.profiles (id, tenant_id, full_name, email, role, is_active)
  VALUES (
    NEW.id,
    new_tenant_id,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1)),
    NEW.email,
    'admin',
    true
  );

  INSERT INTO public.service_items (tenant_id, name, description, unit, default_rate)
  VALUES
    (new_tenant_id, 'Guarding — Day shift',        'Unarmed security officer, 06h00–18h00', 'hour',    35.00),
    (new_tenant_id, 'Guarding — Night shift',      'Unarmed security officer, 18h00–06h00', 'hour',    40.00),
    (new_tenant_id, 'Armed guarding',              'Armed security officer',                 'hour',    55.00),
    (new_tenant_id, 'Site supervisor',             'On-site supervisor',                     'hour',    45.00),
    (new_tenant_id, 'Armed response callout',      'Armed response unit dispatched to site', 'callout', 250.00),
    (new_tenant_id, 'Alarm monitoring',            '24/7 alarm monitoring service',          'month',   450.00),
    (new_tenant_id, 'CCTV monitoring',             'Off-site CCTV monitoring',               'month',   850.00),
    (new_tenant_id, 'K9 patrol unit',              'Handler and patrol dog per shift',       'shift',   650.00),
    (new_tenant_id, 'Event security',              'Security officer per event deployment',  'event',   500.00),
    (new_tenant_id, 'Cash-in-transit escort',      'Escort per trip',                        'trip',    400.00);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_role(p_user uuid, p_role app_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_caller_role text;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then
    raise exception 'No tenant context';
  end if;

  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role <> 'admin' then
    raise exception 'Only admins can change user roles';
  end if;

  if p_user = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;

  update public.profiles
    set role = p_role
    where id = p_user and tenant_id = v_tenant;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_sites(p_user uuid, p_site_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_caller_role text;
  v_target_role text;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then
    raise exception 'No tenant context';
  end if;

  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role not in ('admin','operations','payroll') then
    raise exception 'Not authorized to assign sites';
  end if;

  select role::text into v_target_role
  from public.profiles
  where id = p_user and tenant_id = v_tenant;

  if v_target_role is null then
    raise exception 'Target user not found in your tenant';
  end if;
  if v_target_role not in ('supervisor','security_supervisor') then
    raise exception 'Sites can only be assigned to supervisor roles';
  end if;

  update public.profiles
    set assigned_site_ids = coalesce(p_site_ids, '{}')
    where id = p_user and tenant_id = v_tenant;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_site_supervisors(p_site uuid, p_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_caller_role text;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then
    raise exception 'No tenant context';
  end if;

  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role not in ('admin','operations','payroll') then
    raise exception 'Not authorized to assign supervisors';
  end if;

  if not exists (select 1 from public.sites where id = p_site and tenant_id = v_tenant) then
    raise exception 'Site not found in your tenant';
  end if;

  -- Add the site to selected supervisors that don't already have it.
  update public.profiles
    set assigned_site_ids =
      array(select distinct unnest(coalesce(assigned_site_ids, '{}') || array[p_site]))
    where tenant_id = v_tenant
      and role = 'security_supervisor'
      and id = any(coalesce(p_user_ids, '{}'))
      and not (p_site = any(coalesce(assigned_site_ids, '{}')));

  -- Remove the site from supervisors no longer selected.
  update public.profiles
    set assigned_site_ids = array_remove(coalesce(assigned_site_ids, '{}'), p_site)
    where tenant_id = v_tenant
      and role = 'security_supervisor'
      and not (id = any(coalesce(p_user_ids, '{}')))
      and p_site = any(coalesce(assigned_site_ids, '{}'));
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_draft_payroll(p_period uuid, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role not in ('payroll', 'admin') then
    raise exception 'Not authorized to run payroll';
  end if;

  delete from public.payroll_runs
   where pay_period_id = p_period and status = 'draft' and tenant_id = v_tenant;

  insert into public.payroll_runs (
    tenant_id, employee_id, pay_period_id, normal_hours, overtime_hours, sunday_hours,
    public_holiday_hours, night_hours, rate_per_hour, normal_amount, overtime_amount,
    sunday_amount, public_holiday_amount, night_premium_amount, transport_allowance,
    gross_salary, paye_amount, ssc_amount, consensual_deductions, total_deductions,
    net_salary, compliance_warnings, status)
  select
    v_tenant, (r->>'employee_id')::uuid, p_period,
    (r->>'normal_hours')::numeric, (r->>'overtime_hours')::numeric, (r->>'sunday_hours')::numeric,
    (r->>'public_holiday_hours')::numeric, (r->>'night_hours')::numeric, (r->>'rate_per_hour')::numeric,
    (r->>'normal_amount')::numeric, (r->>'overtime_amount')::numeric, (r->>'sunday_amount')::numeric,
    (r->>'public_holiday_amount')::numeric, (r->>'night_premium_amount')::numeric, (r->>'transport_allowance')::numeric,
    (r->>'gross_salary')::numeric, (r->>'paye_amount')::numeric, (r->>'ssc_amount')::numeric,
    (r->>'consensual_deductions')::numeric, (r->>'total_deductions')::numeric, (r->>'net_salary')::numeric,
    coalesce(r->'compliance_warnings', '[]'::jsonb), 'draft'
  from jsonb_array_elements(p_rows) as r;
end; $function$;

CREATE OR REPLACE FUNCTION public.finalize_payroll_period(p_period uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role not in ('payroll', 'admin') then
    raise exception 'Not authorized to finalize payroll';
  end if;

  update public.payroll_runs
     set status = 'finalized', finalized_at = now()
   where pay_period_id = p_period and status = 'draft' and tenant_id = v_tenant;

  update public.pay_periods
     set status = 'locked', locked_at = now(), locked_by = auth.uid()
   where id = p_period and tenant_id = v_tenant;

  with worked as (
    select sl.employee_id, count(distinct sl.date)::numeric as days
      from public.shift_logs sl
      join public.shift_types st on st.id = sl.shift_type_id
      join public.employees   e  on e.id  = sl.employee_id
     where sl.pay_period_id = p_period
       and sl.tenant_id     = v_tenant
       and sl.status        = 'approved'
       and st.is_leave      = false
       and st.pay_rule      <> 'off'
       and e.status         = 'active'
       and e.category       = 'officer'
     group by sl.employee_id
  ), ins as (
    insert into public.leave_accruals (tenant_id, employee_id, pay_period_id, days_accrued)
    select v_tenant, w.employee_id, p_period, round((w.days / 12.0)::numeric, 4)
      from worked w
     where w.days > 0
    on conflict (employee_id, pay_period_id) do nothing
    returning employee_id, days_accrued
  )
  insert into public.leave_balances (tenant_id, employee_id, annual_days)
  select v_tenant, ins.employee_id, ins.days_accrued from ins
  on conflict (employee_id) do update
     set annual_days = public.leave_balances.annual_days + excluded.annual_days,
         updated_at = now();
end; $function$;

CREATE OR REPLACE FUNCTION public.fn_assign_invoice_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_year text := to_char(COALESCE(NEW.invoice_date, CURRENT_DATE), 'YYYY'); v_seq int;
BEGIN
  IF NEW.type = 'AR' AND (NEW.invoice_number IS NULL OR NEW.invoice_number = '') THEN
    SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '/', 3) AS int)), 0) + 1
      INTO v_seq
      FROM public.invoices
     WHERE tenant_id = NEW.tenant_id
       AND invoice_number LIKE 'INV/' || v_year || '/%';
    NEW.invoice_number := 'INV/' || v_year || '/' || LPAD(v_seq::text, 5, '0');
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_recalc_invoice_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_invoice uuid; v_subtotal numeric(14,2); v_tax numeric(14,2);
BEGIN
  v_invoice := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT COALESCE(SUM(quantity * unit_price), 0),
         COALESCE(SUM(quantity * unit_price * tax_rate), 0)
    INTO v_subtotal, v_tax
  FROM public.invoice_items WHERE invoice_id = v_invoice;
  UPDATE public.invoices
     SET tax = ROUND(v_tax, 2), total = ROUND(v_subtotal + v_tax, 2)
   WHERE id = v_invoice;
  RETURN NULL;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_get_or_create_account(p_tenant uuid, p_code text, p_name text, p_type account_type, p_normal normal_balance_type)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.chart_of_accounts WHERE tenant_id = p_tenant AND code = p_code;
  IF v_id IS NULL THEN
    INSERT INTO public.chart_of_accounts (tenant_id, name, type, code, normal_balance)
    VALUES (p_tenant, p_name, p_type, p_code, p_normal)
    ON CONFLICT (tenant_id, code) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.chart_of_accounts WHERE tenant_id = p_tenant AND code = p_code;
    END IF;
  END IF;
  RETURN v_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_check_ledger_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ledger uuid; v_d numeric(14,2); v_c numeric(14,2);
BEGIN
  v_ledger := COALESCE(NEW.ledger_id, OLD.ledger_id);
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO v_d, v_c
  FROM public.ledger_lines WHERE ledger_id = v_ledger;
  IF v_d <> v_c THEN
    RAISE EXCEPTION 'Ledger % is unbalanced. Debits %, Credits %', v_ledger, v_d, v_c;
  END IF;
  RETURN NULL;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_post_invoice_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ledger uuid; v_total numeric(14,2); v_tax numeric(14,2); v_net numeric(14,2);
        v_old public.invoice_status;
BEGIN
  v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  v_total := COALESCE(NEW.total, 0);
  v_tax   := COALESCE(NEW.tax, 0);
  v_net   := v_total - v_tax;

  IF NEW.status = 'issued' AND v_old IS DISTINCT FROM 'issued' AND v_total > 0 THEN
    INSERT INTO public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    VALUES (NEW.tenant_id, COALESCE(NEW.issued_at::date, NEW.invoice_date, CURRENT_DATE),
            CASE WHEN NEW.type='AR' THEN 'AR invoice issued' ELSE 'AP bill received' END,
            NEW.id, 'invoice_issue')
    RETURNING id INTO v_ledger;

    IF NEW.type='AR' THEN
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'1100','Accounts Receivable','asset','debit'), v_total, 0);
      IF v_net > 0 THEN INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'4000','Security Services Revenue','income','credit'), 0, v_net); END IF;
      IF v_tax > 0 THEN INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2500','VAT Control','liability','credit'), 0, v_tax); END IF;
    ELSE
      IF v_net > 0 THEN INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'5900','General Operating Expenses','expense','debit'), v_net, 0); END IF;
      IF v_tax > 0 THEN INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2500','VAT Control','liability','credit'), v_tax, 0); END IF;
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2400','Accounts Payable','liability','credit'), 0, v_total);
    END IF;
  END IF;

  IF NEW.status = 'paid' AND v_old IS DISTINCT FROM 'paid' AND v_total > 0 THEN
    INSERT INTO public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    VALUES (NEW.tenant_id, COALESCE(NEW.paid_at::date, CURRENT_DATE),
            CASE WHEN NEW.type='AR' THEN 'AR payment received' ELSE 'AP payment made' END,
            NEW.id, 'invoice_payment')
    RETURNING id INTO v_ledger;
    IF NEW.type='AR' THEN
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit) VALUES
        (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'1001','Cash at Bank','asset','debit'), v_total, 0),
        (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'1100','Accounts Receivable','asset','debit'), 0, v_total);
    ELSE
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit) VALUES
        (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2400','Accounts Payable','liability','credit'), v_total, 0),
        (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'1001','Cash at Bank','asset','debit'), 0, v_total);
    END IF;
  END IF;

  IF NEW.status = 'void' AND v_old IS DISTINCT FROM 'void' THEN
    INSERT INTO public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    VALUES (NEW.tenant_id, CURRENT_DATE, 'Invoice voided (reversal)', NEW.id, 'invoice_void')
    RETURNING id INTO v_ledger;
    INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
    SELECT ll.tenant_id, v_ledger, ll.account_id, ll.credit, ll.debit
    FROM public.ledger_lines ll
    JOIN public.ledger_entries le ON le.id = ll.ledger_id
    WHERE le.reference_id = NEW.id AND le.reference_type = 'invoice_issue';
  END IF;

  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_post_payroll_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ledger uuid; v_other numeric(14,2);
BEGIN
  IF NEW.status = 'finalized' AND OLD.status IS DISTINCT FROM 'finalized' AND NEW.gross_salary > 0 THEN
    v_other := NEW.total_deductions - NEW.paye_amount - NEW.ssc_amount;
    INSERT INTO public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    VALUES (NEW.tenant_id, COALESCE(NEW.finalized_at::date, CURRENT_DATE), 'Payroll finalized', NEW.id, 'payroll_run')
    RETURNING id INTO v_ledger;

    INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
    VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'5000','Salaries & Wages Expense','expense','debit'), NEW.gross_salary, 0);
    IF NEW.paye_amount > 0 THEN INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2200','PAYE Tax Payable','liability','credit'), 0, NEW.paye_amount); END IF;
    IF NEW.ssc_amount > 0 THEN INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2300','SSC Contributions Payable','liability','credit'), 0, NEW.ssc_amount); END IF;
    IF v_other > 0 THEN INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2600','Other Payroll Deductions','liability','credit'), 0, v_other); END IF;
    IF NEW.net_salary > 0 THEN INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2100','Wages Payable','liability','credit'), 0, NEW.net_salary); END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- ------------------------------------------------------------------
-- 7. RLS POLICIES (permissive tenant scoping + restrictive role gates)
-- Remember to `alter table ... enable row level security` on every table.
-- ------------------------------------------------------------------
create policy ai_audit_insert on public.ai_audit_events as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy ai_audit_select on public.ai_audit_events as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy ai_messages_insert on public.ai_conversation_messages as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy ai_messages_select on public.ai_conversation_messages as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy ai_sessions_insert on public.ai_conversation_sessions as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy ai_sessions_select on public.ai_conversation_sessions as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy ai_memories_insert on public.ai_executive_memories as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy ai_memories_select on public.ai_executive_memories as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy attendance_logs_insert on public.attendance_logs as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy attendance_logs_select on public.attendance_logs as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy attendance_logs_role_insert on public.attendance_logs as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy attendance_logs_role_update on public.attendance_logs as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy attendance_logs_role_delete on public.attendance_logs as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy audit_events_insert on public.audit_events as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy audit_events_select on public.audit_events as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy chart_of_accounts_insert on public.chart_of_accounts as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy chart_of_accounts_select on public.chart_of_accounts as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy chart_of_accounts_update on public.chart_of_accounts as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy chart_of_accounts_role_insert on public.chart_of_accounts as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy chart_of_accounts_role_update on public.chart_of_accounts as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy chart_of_accounts_role_delete on public.chart_of_accounts as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy clients_delete on public.clients as permissive for delete to public using ((tenant_id = get_my_tenant_id()));
create policy clients_insert on public.clients as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy clients_select on public.clients as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy clients_update on public.clients as permissive for update to public using ((tenant_id = get_my_tenant_id())) with check ((tenant_id = get_my_tenant_id()));
create policy clients_role_insert on public.clients as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,accountant}'::text[])));
create policy clients_role_update on public.clients as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,accountant}'::text[])));
create policy clients_role_delete on public.clients as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,accountant}'::text[])));
create policy deduction_types_insert on public.deduction_types as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy deduction_types_select on public.deduction_types as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy deduction_types_update on public.deduction_types as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy deduction_types_role_insert on public.deduction_types as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy deduction_types_role_update on public.deduction_types as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy deduction_types_role_delete on public.deduction_types as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy deductions_insert on public.deductions as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy deductions_select on public.deductions as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy deductions_update on public.deductions as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy deductions_role_insert on public.deductions as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy deductions_role_update on public.deductions as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy deductions_role_delete on public.deductions as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy disciplinary_actions_insert on public.disciplinary_actions as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy disciplinary_actions_select on public.disciplinary_actions as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy disciplinary_actions_update on public.disciplinary_actions as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy disciplinary_actions_role_insert on public.disciplinary_actions as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy disciplinary_actions_role_update on public.disciplinary_actions as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy disciplinary_actions_role_delete on public.disciplinary_actions as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy employees_insert on public.employees as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy employees_select on public.employees as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy employees_update on public.employees as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy employees_role_insert on public.employees as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy employees_role_update on public.employees as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy employees_role_delete on public.employees as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy installment_plans_insert on public.installment_plans as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy installment_plans_select on public.installment_plans as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy installment_plans_update on public.installment_plans as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy installment_plans_role_insert on public.installment_plans as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy installment_plans_role_update on public.installment_plans as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy installment_plans_role_delete on public.installment_plans as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy invoice_items_insert on public.invoice_items as permissive for insert to public with check ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_items.invoice_id) AND (i.tenant_id = get_my_tenant_id())))));
create policy invoice_items_select on public.invoice_items as permissive for select to public using ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_items.invoice_id) AND (i.tenant_id = get_my_tenant_id())))));
create policy invoice_items_update on public.invoice_items as permissive for update to public using ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_items.invoice_id) AND (i.tenant_id = get_my_tenant_id())))));
create policy invoice_items_role_insert on public.invoice_items as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy invoice_items_role_update on public.invoice_items as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy invoice_items_role_delete on public.invoice_items as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy invoices_insert on public.invoices as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy invoices_select on public.invoices as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy invoices_update on public.invoices as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy invoices_role_insert on public.invoices as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy invoices_role_update on public.invoices as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy invoices_role_delete on public.invoices as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy leave_accruals_insert on public.leave_accruals as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy leave_accruals_select on public.leave_accruals as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy leave_accruals_update on public.leave_accruals as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy leave_accruals_role_insert on public.leave_accruals as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy leave_accruals_role_update on public.leave_accruals as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy leave_accruals_role_delete on public.leave_accruals as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy leave_balances_insert on public.leave_balances as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy leave_balances_select on public.leave_balances as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy leave_balances_update on public.leave_balances as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy leave_balances_role_insert on public.leave_balances as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy leave_balances_role_update on public.leave_balances as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy leave_balances_role_delete on public.leave_balances as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy ledger_entries_insert on public.ledger_entries as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy ledger_entries_select on public.ledger_entries as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy ledger_entries_role_insert on public.ledger_entries as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy ledger_entries_role_update on public.ledger_entries as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy ledger_entries_role_delete on public.ledger_entries as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy ledger_lines_insert on public.ledger_lines as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy ledger_lines_select on public.ledger_lines as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy ledger_lines_role_insert on public.ledger_lines as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy ledger_lines_role_update on public.ledger_lines as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy ledger_lines_role_delete on public.ledger_lines as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy pay_periods_insert on public.pay_periods as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy pay_periods_select on public.pay_periods as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy pay_periods_update on public.pay_periods as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy pay_periods_role_insert on public.pay_periods as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy pay_periods_role_update on public.pay_periods as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy pay_periods_role_delete on public.pay_periods as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy paye_brackets_select on public.paye_brackets as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy payroll_constants_select on public.payroll_constants as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy payroll_constants_update on public.payroll_constants as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy payroll_constants_role_insert on public.payroll_constants as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin}'::text[])));
create policy payroll_constants_role_update on public.payroll_constants as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin}'::text[])));
create policy payroll_constants_role_delete on public.payroll_constants as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin}'::text[])));
create policy payroll_runs_insert on public.payroll_runs as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy payroll_runs_select on public.payroll_runs as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy payroll_runs_update on public.payroll_runs as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy payroll_runs_role_insert on public.payroll_runs as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy payroll_runs_role_update on public.payroll_runs as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy payroll_runs_role_delete on public.payroll_runs as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy profiles_select_own on public.profiles as permissive for select to authenticated using ((id = auth.uid()));
create policy profiles_select_tenant on public.profiles as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy profiles_update_own on public.profiles as permissive for update to authenticated using ((id = auth.uid())) with check ((id = auth.uid()));
create policy ps_exemptions_insert on public.ps_exemptions as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy ps_exemptions_select on public.ps_exemptions as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy ps_exemptions_role_insert on public.ps_exemptions as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy ps_exemptions_role_update on public.ps_exemptions as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy ps_exemptions_role_delete on public.ps_exemptions as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,payroll}'::text[])));
create policy public_holidays_select on public.public_holidays as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy schedule_assignments_delete on public.schedule_assignments as permissive for delete to public using ((tenant_id = get_my_tenant_id()));
create policy schedule_assignments_insert on public.schedule_assignments as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy schedule_assignments_select on public.schedule_assignments as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy schedule_assignments_update on public.schedule_assignments as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy schedule_assignments_role_insert on public.schedule_assignments as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy schedule_assignments_role_update on public.schedule_assignments as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy schedule_assignments_role_delete on public.schedule_assignments as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy service_items_delete on public.service_items as permissive for delete to public using ((tenant_id = get_my_tenant_id()));
create policy service_items_insert on public.service_items as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy service_items_select on public.service_items as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy service_items_update on public.service_items as permissive for update to public using ((tenant_id = get_my_tenant_id())) with check ((tenant_id = get_my_tenant_id()));
create policy service_items_role_insert on public.service_items as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy service_items_role_update on public.service_items as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy service_items_role_delete on public.service_items as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy shift_logs_insert on public.shift_logs as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy shift_logs_select on public.shift_logs as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy shift_logs_update on public.shift_logs as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy shift_logs_role_insert on public.shift_logs as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy shift_logs_role_update on public.shift_logs as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy shift_logs_role_delete on public.shift_logs as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll,security_supervisor}'::text[])));
create policy shift_types_insert on public.shift_types as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy shift_types_select on public.shift_types as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy shift_types_update on public.shift_types as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy shift_types_role_insert on public.shift_types as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy shift_types_role_update on public.shift_types as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy shift_types_role_delete on public.shift_types as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy signed_agreements_insert on public.signed_agreements as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy signed_agreements_select on public.signed_agreements as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy signed_agreements_role_insert on public.signed_agreements as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy signed_agreements_role_update on public.signed_agreements as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy signed_agreements_role_delete on public.signed_agreements as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations,supervisor,payroll}'::text[])));
create policy site_requirements_insert on public.site_requirements as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy site_requirements_select on public.site_requirements as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy site_requirements_update on public.site_requirements as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy site_requirements_role_insert on public.site_requirements as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations}'::text[])));
create policy site_requirements_role_update on public.site_requirements as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations}'::text[])));
create policy site_requirements_role_delete on public.site_requirements as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations}'::text[])));
create policy sites_insert on public.sites as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy sites_select on public.sites as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy sites_update on public.sites as permissive for update to public using ((tenant_id = get_my_tenant_id()));
create policy sites_role_insert on public.sites as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,operations}'::text[])));
create policy sites_role_update on public.sites as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,operations}'::text[])));
create policy sites_role_delete on public.sites as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,operations}'::text[])));
create policy tenants_select on public.tenants as permissive for select to public using ((id = get_my_tenant_id()));
create policy tenants_update_admin on public.tenants as permissive for update to authenticated using ((id = get_my_tenant_id())) with check ((id = get_my_tenant_id()));
create policy tenants_role_insert on public.tenants as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin}'::text[])));
create policy tenants_role_update on public.tenants as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin}'::text[])));
create policy tenants_role_delete on public.tenants as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin}'::text[])));
create policy vendors_delete on public.vendors as permissive for delete to public using ((tenant_id = get_my_tenant_id()));
create policy vendors_insert on public.vendors as permissive for insert to public with check ((tenant_id = get_my_tenant_id()));
create policy vendors_select on public.vendors as permissive for select to public using ((tenant_id = get_my_tenant_id()));
create policy vendors_update on public.vendors as permissive for update to public using ((tenant_id = get_my_tenant_id())) with check ((tenant_id = get_my_tenant_id()));
create policy vendors_role_insert on public.vendors as restrictive for insert to authenticated with check ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy vendors_role_update on public.vendors as restrictive for update to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));
create policy vendors_role_delete on public.vendors as restrictive for delete to authenticated using ((get_my_role() = ANY ('{admin,accountant}'::text[])));

-- end of baseline
