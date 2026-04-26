
-- ============================================================================
-- DOG FORCE PAYROLL & SCHEDULING ERP — FOUNDATIONAL SCHEMA
-- Multi-tenant from day one. Every domain table carries tenant_id.
-- RLS: scoped by tenant; supervisors further scoped by assigned_site_ids.
-- ============================================================================

-- ---------- ENUMS ----------
CREATE TYPE public.app_role AS ENUM ('admin', 'operations', 'supervisor', 'viewer');
CREATE TYPE public.employee_position AS ENUM ('security_officer','supervisor','site_manager','operations_manager','admin','other');
CREATE TYPE public.employee_category AS ENUM ('officer','management');
CREATE TYPE public.employee_status AS ENUM ('active','suspended','terminated');
CREATE TYPE public.day_of_week AS ENUM ('mon','tue','wed','thu','fri','sat','sun','any');
CREATE TYPE public.shift_period AS ENUM ('morning','day','night','full_day');
CREATE TYPE public.pay_rule AS ENUM ('standard','sunday_default','sunday_ordinary','public_holiday_ordinary','public_holiday_non_ordinary','leave','off');
CREATE TYPE public.pay_period_status AS ENUM ('open','locked','paid');
CREATE TYPE public.shift_log_status AS ENUM ('pending','approved','no_show','replaced_by_other','suspended_unpaid');
CREATE TYPE public.deduction_category AS ENUM ('statutory','recurring','offence_fine','offence_suspension','loan','other');
CREATE TYPE public.installment_status AS ENUM ('active','paid_off','paused','written_off');
CREATE TYPE public.payroll_run_status AS ENUM ('draft','finalized','paid');
CREATE TYPE public.disciplinary_action_type AS ENUM ('verbal_warning','written_warning','final_warning','unpaid_suspension','fine_with_ca','dismissal');

-- ---------- HELPER: timestamp trigger ----------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ---------- TENANTS ----------
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_name TEXT,
  sesorb_registration_number TEXT,
  s17_3_exemption_document_url TEXT,
  s17_3_exemption_reference TEXT,
  default_hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 16.00,
  default_transport_allowance NUMERIC(10,2) NOT NULL DEFAULT 350.00,
  pay_period_start_day SMALLINT NOT NULL DEFAULT 21,
  pay_date_day SMALLINT NOT NULL DEFAULT 16,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenants_touch BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- PROFILES (system users) ----------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,            -- mirrors auth.users.id
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  role public.app_role NOT NULL DEFAULT 'viewer',
  assigned_site_ids UUID[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_tenant ON public.profiles(tenant_id);
CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- SECURITY DEFINER HELPERS (avoid RLS recursion) ----------
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_site_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(assigned_site_ids, '{}'::uuid[]) FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.has_role(_role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_ops()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','operations'))
$$;

CREATE OR REPLACE FUNCTION public.can_access_site(_site_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role IN ('admin','operations') OR _site_id = ANY(p.assigned_site_ids))
  )
$$;

-- ---------- AUTO-PROVISION PROFILE ON SIGNUP ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id UUID;
  v_existing_count INT;
BEGIN
  -- First user becomes admin of the default tenant; subsequent signups become viewers under same tenant.
  SELECT COUNT(*) INTO v_existing_count FROM public.profiles;
  SELECT id INTO v_tenant_id FROM public.tenants ORDER BY created_at LIMIT 1;
  IF v_tenant_id IS NULL THEN
    INSERT INTO public.tenants (name) VALUES ('Dog Force Security Services') RETURNING id INTO v_tenant_id;
  END IF;
  INSERT INTO public.profiles (id, tenant_id, full_name, email, role)
  VALUES (
    NEW.id,
    v_tenant_id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    CASE WHEN v_existing_count = 0 THEN 'admin'::public.app_role ELSE 'viewer'::public.app_role END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- PAYROLL CONSTANTS (statutory rates, editable) ----------
CREATE TABLE public.payroll_constants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value NUMERIC(14,4) NOT NULL,
  description TEXT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key, effective_from)
);
CREATE INDEX idx_payroll_constants_tenant ON public.payroll_constants(tenant_id);
CREATE TRIGGER trg_payroll_constants_touch BEFORE UPDATE ON public.payroll_constants FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- PAYE BRACKETS ----------
CREATE TABLE public.paye_brackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lower_bound NUMERIC(14,2) NOT NULL,
  upper_bound NUMERIC(14,2),     -- NULL = no upper bound
  base_tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  marginal_rate NUMERIC(6,4) NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_paye_brackets_tenant ON public.paye_brackets(tenant_id);

-- ---------- SITES ----------
CREATE TABLE public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  address TEXT,
  client_name TEXT,
  default_shifts JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sites_tenant ON public.sites(tenant_id);
CREATE TRIGGER trg_sites_touch BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- EMPLOYEES (the guards being paid) ----------
CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_code TEXT NOT NULL,
  surname TEXT NOT NULL,
  first_names TEXT NOT NULL,
  display_name TEXT GENERATED ALWAYS AS (surname || ', ' || first_names) STORED,
  national_id TEXT,
  sesorb_registration_number TEXT,
  position public.employee_position NOT NULL DEFAULT 'security_officer',
  category public.employee_category NOT NULL DEFAULT 'officer',
  start_date DATE,
  bank_name TEXT,
  bank_account_number TEXT,
  phone TEXT,
  email TEXT,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 16.00,
  transport_allowance NUMERIC(10,2) NOT NULL DEFAULT 350.00,
  union_member BOOLEAN NOT NULL DEFAULT false,
  ordinarily_works_sundays BOOLEAN NOT NULL DEFAULT false,
  sunday_agreement_url TEXT,         -- written agreement enabling 1.5× Sunday rate
  home_site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  status public.employee_status NOT NULL DEFAULT 'active',
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_code)
);
CREATE INDEX idx_employees_tenant ON public.employees(tenant_id);
CREATE INDEX idx_employees_home_site ON public.employees(home_site_id);
CREATE INDEX idx_employees_status ON public.employees(status);
CREATE TRIGGER trg_employees_touch BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- SHIFT TYPES ----------
CREATE TABLE public.shift_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  day_of_week public.day_of_week NOT NULL DEFAULT 'any',
  period public.shift_period NOT NULL DEFAULT 'full_day',
  default_hours NUMERIC(5,2) NOT NULL DEFAULT 12,
  pay_rule public.pay_rule NOT NULL DEFAULT 'standard',
  rate_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  is_leave BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_shift_types_tenant ON public.shift_types(tenant_id);
CREATE TRIGGER trg_shift_types_touch BEFORE UPDATE ON public.shift_types FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- DEDUCTION TYPES ----------
CREATE TABLE public.deduction_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  category public.deduction_category NOT NULL,
  default_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_percentage BOOLEAN NOT NULL DEFAULT false,
  percentage NUMERIC(7,4),
  requires_evidence BOOLEAN NOT NULL DEFAULT false,
  requires_collective_agreement BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_deduction_types_tenant ON public.deduction_types(tenant_id);
CREATE TRIGGER trg_deduction_types_touch BEFORE UPDATE ON public.deduction_types FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- PAY PERIODS ----------
CREATE TABLE public.pay_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  pay_date DATE NOT NULL,
  status public.pay_period_status NOT NULL DEFAULT 'open',
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, start_date)
);
CREATE INDEX idx_pay_periods_tenant ON public.pay_periods(tenant_id);
CREATE TRIGGER trg_pay_periods_touch BEFORE UPDATE ON public.pay_periods FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- INSTALLMENT PLANS ----------
CREATE TABLE public.installment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  deduction_type_id UUID NOT NULL REFERENCES public.deduction_types(id),
  purpose TEXT NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL,
  monthly_amount NUMERIC(12,2) NOT NULL,
  start_period_id UUID REFERENCES public.pay_periods(id),
  end_period_id UUID REFERENCES public.pay_periods(id),
  balance_remaining NUMERIC(12,2) NOT NULL,
  status public.installment_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_installments_employee ON public.installment_plans(employee_id);
CREATE INDEX idx_installments_tenant ON public.installment_plans(tenant_id);
CREATE TRIGGER trg_installments_touch BEFORE UPDATE ON public.installment_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- SCHEDULE ASSIGNMENTS ----------
CREATE TABLE public.schedule_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift_type_id UUID NOT NULL REFERENCES public.shift_types(id),
  planned_hours NUMERIC(5,2) NOT NULL,
  is_replacement BOOLEAN NOT NULL DEFAULT false,
  replaced_assignment_id UUID REFERENCES public.schedule_assignments(id),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_assignments_tenant_date ON public.schedule_assignments(tenant_id, date);
CREATE INDEX idx_assignments_employee_date ON public.schedule_assignments(employee_id, date);
CREATE INDEX idx_assignments_site_date ON public.schedule_assignments(site_id, date);
CREATE TRIGGER trg_assignments_touch BEFORE UPDATE ON public.schedule_assignments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- SHIFT LOGS ----------
CREATE TABLE public.shift_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES public.schedule_assignments(id) ON DELETE SET NULL,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  pay_period_id UUID NOT NULL REFERENCES public.pay_periods(id),
  date DATE NOT NULL,
  site_id UUID NOT NULL REFERENCES public.sites(id),
  shift_type_id UUID NOT NULL REFERENCES public.shift_types(id),
  hours_worked NUMERIC(5,2) NOT NULL DEFAULT 0,
  night_hours NUMERIC(5,2) NOT NULL DEFAULT 0,    -- portion falling between 20:00–07:00
  status public.shift_log_status NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shift_logs_tenant_period ON public.shift_logs(tenant_id, pay_period_id);
CREATE INDEX idx_shift_logs_employee_period ON public.shift_logs(employee_id, pay_period_id);
CREATE INDEX idx_shift_logs_site_date ON public.shift_logs(site_id, date);
CREATE INDEX idx_shift_logs_status ON public.shift_logs(status);
CREATE TRIGGER trg_shift_logs_touch BEFORE UPDATE ON public.shift_logs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- DISCIPLINARY ACTIONS (Labour Act compliant) ----------
CREATE TABLE public.disciplinary_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  action_type public.disciplinary_action_type NOT NULL,
  offence_code TEXT NOT NULL,
  incident_date DATE NOT NULL,
  incident_site_id UUID REFERENCES public.sites(id),
  description TEXT NOT NULL,
  evidence_url TEXT,
  -- For unpaid_suspension:
  suspension_hours NUMERIC(6,2) DEFAULT 0,
  suspension_pay_period_id UUID REFERENCES public.pay_periods(id),
  -- For fine_with_ca:
  fine_amount NUMERIC(12,2) DEFAULT 0,
  collective_agreement_reference TEXT,
  collective_agreement_url TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_fine_requires_ca CHECK (
    action_type <> 'fine_with_ca'
    OR (collective_agreement_reference IS NOT NULL AND length(trim(collective_agreement_reference)) > 0)
  )
);
CREATE INDEX idx_disciplinary_employee ON public.disciplinary_actions(employee_id);
CREATE INDEX idx_disciplinary_tenant ON public.disciplinary_actions(tenant_id);
CREATE TRIGGER trg_disciplinary_touch BEFORE UPDATE ON public.disciplinary_actions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- DEDUCTIONS ----------
CREATE TABLE public.deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  pay_period_id UUID NOT NULL REFERENCES public.pay_periods(id),
  deduction_type_id UUID NOT NULL REFERENCES public.deduction_types(id),
  amount NUMERIC(12,2) NOT NULL,
  incident_date DATE,
  incident_site_id UUID REFERENCES public.sites(id),
  note TEXT,
  evidence_url TEXT,
  installment_plan_id UUID REFERENCES public.installment_plans(id),
  disciplinary_action_id UUID REFERENCES public.disciplinary_actions(id),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deductions_employee_period ON public.deductions(employee_id, pay_period_id);
CREATE INDEX idx_deductions_tenant ON public.deductions(tenant_id);
CREATE TRIGGER trg_deductions_touch BEFORE UPDATE ON public.deductions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- PAYROLL RUNS ----------
CREATE TABLE public.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  pay_period_id UUID NOT NULL REFERENCES public.pay_periods(id),
  normal_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  sunday_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  public_holiday_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  night_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  rate_per_hour NUMERIC(10,2) NOT NULL,
  normal_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  sunday_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  public_holiday_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  night_premium_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  transport_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  ssc_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paye_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_statutory NUMERIC(12,2) NOT NULL DEFAULT 0,
  consensual_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  compliance_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  leave_balances_snapshot JSONB,
  status public.payroll_run_status NOT NULL DEFAULT 'draft',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, pay_period_id)
);
CREATE INDEX idx_payroll_runs_period ON public.payroll_runs(pay_period_id);
CREATE INDEX idx_payroll_runs_tenant ON public.payroll_runs(tenant_id);
CREATE TRIGGER trg_payroll_runs_touch BEFORE UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- LEAVE BALANCES ----------
CREATE TABLE public.leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL UNIQUE REFERENCES public.employees(id) ON DELETE CASCADE,
  annual_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  sick_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  compassionate_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  off_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leave_balances_tenant ON public.leave_balances(tenant_id);
CREATE TRIGGER trg_leave_balances_touch BEFORE UPDATE ON public.leave_balances FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- PUBLIC HOLIDAYS ----------
CREATE TABLE public.public_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, date)
);
CREATE INDEX idx_public_holidays_tenant ON public.public_holidays(tenant_id);

-- ---------- AUDIT LOG (append-only) ----------
CREATE TABLE public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  actor_id UUID REFERENCES public.profiles(id),
  actor_email TEXT,
  table_name TEXT NOT NULL,
  record_id UUID,
  action TEXT NOT NULL,            -- INSERT/UPDATE/DELETE/LOCK/FINALIZE/EXPORT etc.
  old_values JSONB,
  new_values JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON public.audit_events(tenant_id);
CREATE INDEX idx_audit_table_record ON public.audit_events(table_name, record_id);
CREATE INDEX idx_audit_created ON public.audit_events(created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_constants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paye_brackets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_types           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deduction_types       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_periods           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_plans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disciplinary_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deductions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_holidays       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events          ENABLE ROW LEVEL SECURITY;

-- TENANTS
CREATE POLICY "members_view_own_tenant" ON public.tenants FOR SELECT USING (id = public.current_tenant_id());
CREATE POLICY "admins_update_own_tenant" ON public.tenants FOR UPDATE USING (id = public.current_tenant_id() AND public.has_role('admin'));

-- PROFILES
CREATE POLICY "view_profiles_in_tenant" ON public.profiles FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY "users_update_own_profile" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "admins_manage_profiles" ON public.profiles FOR ALL USING (tenant_id = public.current_tenant_id() AND public.has_role('admin')) WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role('admin'));

-- Generic tenant-scoped policies
-- Reusable pattern: read for any tenant member; write for admin/operations.

-- PAYROLL CONSTANTS, PAYE BRACKETS, SHIFT TYPES, DEDUCTION TYPES, PAY PERIODS, PUBLIC HOLIDAYS — admin/ops manage, all tenant members read
DO $$ DECLARE t TEXT; tables TEXT[] := ARRAY[
  'payroll_constants','paye_brackets','shift_types','deduction_types','pay_periods','public_holidays'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('CREATE POLICY "tenant_read_%1$s" ON public.%1$I FOR SELECT USING (tenant_id = public.current_tenant_id())', t);
    EXECUTE format('CREATE POLICY "ops_write_%1$s" ON public.%1$I FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops())', t);
  END LOOP;
END $$;

-- SITES (admin/ops full; supervisors read assigned)
CREATE POLICY "sites_admin_ops_all" ON public.sites FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());
CREATE POLICY "sites_supervisor_read" ON public.sites FOR SELECT USING (tenant_id = public.current_tenant_id() AND id = ANY(public.current_site_ids()));
CREATE POLICY "sites_viewer_read" ON public.sites FOR SELECT USING (tenant_id = public.current_tenant_id() AND public.has_role('viewer'));

-- EMPLOYEES (admin/ops full; supervisors read employees with home_site in their sites OR who worked at their sites)
CREATE POLICY "employees_admin_ops_all" ON public.employees FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());
CREATE POLICY "employees_supervisor_read" ON public.employees FOR SELECT USING (
  tenant_id = public.current_tenant_id()
  AND (home_site_id = ANY(public.current_site_ids()) OR public.has_role('viewer'))
);

-- INSTALLMENT PLANS (admin/ops only)
CREATE POLICY "installments_admin_ops_all" ON public.installment_plans FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());

-- SCHEDULE ASSIGNMENTS (admin/ops full; supervisors full within their sites)
CREATE POLICY "assignments_admin_ops_all" ON public.schedule_assignments FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());
CREATE POLICY "assignments_supervisor_all" ON public.schedule_assignments FOR ALL USING (
  tenant_id = public.current_tenant_id() AND site_id = ANY(public.current_site_ids())
) WITH CHECK (
  tenant_id = public.current_tenant_id() AND site_id = ANY(public.current_site_ids())
);

-- SHIFT LOGS (admin/ops full; supervisors full within their sites)
CREATE POLICY "shift_logs_admin_ops_all" ON public.shift_logs FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());
CREATE POLICY "shift_logs_supervisor_all" ON public.shift_logs FOR ALL USING (
  tenant_id = public.current_tenant_id() AND site_id = ANY(public.current_site_ids())
) WITH CHECK (
  tenant_id = public.current_tenant_id() AND site_id = ANY(public.current_site_ids())
);

-- DISCIPLINARY ACTIONS (admin/ops only — sensitive)
CREATE POLICY "disciplinary_admin_ops_all" ON public.disciplinary_actions FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());
CREATE POLICY "disciplinary_supervisor_create" ON public.disciplinary_actions FOR INSERT WITH CHECK (
  tenant_id = public.current_tenant_id() AND incident_site_id = ANY(public.current_site_ids())
);
CREATE POLICY "disciplinary_supervisor_read" ON public.disciplinary_actions FOR SELECT USING (
  tenant_id = public.current_tenant_id() AND incident_site_id = ANY(public.current_site_ids())
);

-- DEDUCTIONS (admin/ops only)
CREATE POLICY "deductions_admin_ops_all" ON public.deductions FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());

-- PAYROLL RUNS (admin/ops only; viewers read)
CREATE POLICY "payroll_runs_admin_ops_all" ON public.payroll_runs FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());
CREATE POLICY "payroll_runs_viewer_read" ON public.payroll_runs FOR SELECT USING (tenant_id = public.current_tenant_id() AND public.has_role('viewer'));

-- LEAVE BALANCES (admin/ops full; supervisors read for their site employees)
CREATE POLICY "leave_balances_admin_ops_all" ON public.leave_balances FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());
CREATE POLICY "leave_balances_supervisor_read" ON public.leave_balances FOR SELECT USING (
  tenant_id = public.current_tenant_id()
  AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = leave_balances.employee_id AND e.home_site_id = ANY(public.current_site_ids()))
);

-- AUDIT EVENTS (admin/ops read; system writes via SECURITY DEFINER trigger)
CREATE POLICY "audit_admin_ops_read" ON public.audit_events FOR SELECT USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());
-- No insert policy: only triggers (security definer) write here.

-- ============================================================================
-- LOCK PROTECTION: prevent edits on locked pay periods
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prevent_edits_on_locked_period()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_status public.pay_period_status;
  v_period_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_period_id := COALESCE(OLD.pay_period_id, NULL);
  ELSE
    v_period_id := COALESCE(NEW.pay_period_id, NULL);
  END IF;
  IF v_period_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO v_status FROM public.pay_periods WHERE id = v_period_id;
  IF v_status IN ('locked','paid') THEN
    RAISE EXCEPTION 'Pay period is locked. No edits permitted on % (record %).', TG_TABLE_NAME, COALESCE(NEW.id, OLD.id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_lock_shift_logs BEFORE INSERT OR UPDATE OR DELETE ON public.shift_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_edits_on_locked_period();
CREATE TRIGGER trg_lock_deductions BEFORE INSERT OR UPDATE OR DELETE ON public.deductions FOR EACH ROW EXECUTE FUNCTION public.prevent_edits_on_locked_period();

-- ============================================================================
-- AUDIT TRIGGER (writes to audit_events on every mutation)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.write_audit_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID;
  v_actor UUID := auth.uid();
  v_actor_email TEXT;
  v_record UUID;
BEGIN
  v_tenant := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid,
    NULL
  );
  -- Derive tenant from row
  IF TG_OP = 'DELETE' THEN
    v_tenant := COALESCE((to_jsonb(OLD)->>'tenant_id')::uuid, v_tenant);
    v_record := COALESCE((to_jsonb(OLD)->>'id')::uuid, NULL);
  ELSE
    v_tenant := COALESCE((to_jsonb(NEW)->>'tenant_id')::uuid, v_tenant);
    v_record := COALESCE((to_jsonb(NEW)->>'id')::uuid, NULL);
  END IF;
  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.audit_events (tenant_id, actor_id, actor_email, table_name, record_id, action, old_values, new_values)
  VALUES (
    v_tenant, v_actor, v_actor_email, TG_TABLE_NAME, v_record, TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach audit triggers to mutation-sensitive tables
CREATE TRIGGER trg_audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_sites AFTER INSERT OR UPDATE OR DELETE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_shift_logs AFTER INSERT OR UPDATE OR DELETE ON public.shift_logs FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_deductions AFTER INSERT OR UPDATE OR DELETE ON public.deductions FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_disciplinary AFTER INSERT OR UPDATE OR DELETE ON public.disciplinary_actions FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_payroll_runs AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_pay_periods AFTER INSERT OR UPDATE OR DELETE ON public.pay_periods FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_installments AFTER INSERT OR UPDATE OR DELETE ON public.installment_plans FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_payroll_constants AFTER INSERT OR UPDATE OR DELETE ON public.payroll_constants FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_paye_brackets AFTER INSERT OR UPDATE OR DELETE ON public.paye_brackets FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
CREATE TRIGGER trg_audit_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();

-- ============================================================================
-- STORAGE BUCKETS
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('evidence', 'evidence', false),
  ('agreements', 'agreements', false),
  ('photos', 'photos', true)
ON CONFLICT DO NOTHING;

-- Evidence bucket: tenant-scoped via folder = tenant_id
CREATE POLICY "evidence_tenant_read" ON storage.objects FOR SELECT USING (
  bucket_id = 'evidence' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);
CREATE POLICY "evidence_admin_ops_write" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'evidence' AND (storage.foldername(name))[1] = public.current_tenant_id()::text AND public.is_admin_or_ops()
);
CREATE POLICY "evidence_admin_ops_update" ON storage.objects FOR UPDATE USING (
  bucket_id = 'evidence' AND (storage.foldername(name))[1] = public.current_tenant_id()::text AND public.is_admin_or_ops()
);
CREATE POLICY "evidence_admin_ops_delete" ON storage.objects FOR DELETE USING (
  bucket_id = 'evidence' AND (storage.foldername(name))[1] = public.current_tenant_id()::text AND public.is_admin_or_ops()
);

CREATE POLICY "agreements_tenant_read" ON storage.objects FOR SELECT USING (
  bucket_id = 'agreements' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);
CREATE POLICY "agreements_admin_write" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'agreements' AND (storage.foldername(name))[1] = public.current_tenant_id()::text AND public.has_role('admin')
);

CREATE POLICY "photos_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'photos');
CREATE POLICY "photos_admin_ops_write" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'photos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text AND public.is_admin_or_ops()
);
