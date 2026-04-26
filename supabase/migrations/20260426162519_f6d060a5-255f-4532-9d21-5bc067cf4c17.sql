
-- ============================================================
-- PS Exemptions: weekly >60h waiver per employee per ISO week
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ps_exemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NOT NULL,
  reference TEXT NOT NULL,
  document_url TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ps_dates CHECK (effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_ps_exemptions_emp ON public.ps_exemptions (employee_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_ps_exemptions_tenant ON public.ps_exemptions (tenant_id);

ALTER TABLE public.ps_exemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ps_exemptions_admin_ops_all ON public.ps_exemptions
  FOR ALL USING (tenant_id = current_tenant_id() AND is_admin_or_ops())
  WITH CHECK (tenant_id = current_tenant_id() AND is_admin_or_ops());

CREATE POLICY ps_exemptions_tenant_read ON public.ps_exemptions
  FOR SELECT USING (tenant_id = current_tenant_id());

CREATE TRIGGER trg_ps_exemptions_touch
  BEFORE UPDATE ON public.ps_exemptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- attendance_logs: a view alias over shift_logs so the
-- payroll engine and analytics can reference a stable name.
-- ============================================================
CREATE OR REPLACE VIEW public.attendance_logs AS
  SELECT
    id,
    tenant_id,
    employee_id,
    site_id,
    shift_type_id,
    pay_period_id,
    assignment_id,
    date,
    hours_worked,
    night_hours,
    status,
    approved_by,
    approved_at,
    notes,
    created_at,
    updated_at
  FROM public.shift_logs;

-- ============================================================
-- Helper: weekly hours for an employee in an ISO week
-- (Used by the scheduler to flag >60h)
-- ============================================================
CREATE OR REPLACE FUNCTION public.employee_week_hours(_employee_id UUID, _any_date DATE)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(planned_hours), 0)::numeric
  FROM public.schedule_assignments
  WHERE employee_id = _employee_id
    AND date_trunc('week', date)::date = date_trunc('week', _any_date)::date
$$;

-- ============================================================
-- Helper: does employee have an active PS exemption on _date?
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_ps_exemption(_employee_id UUID, _date DATE)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ps_exemptions
    WHERE employee_id = _employee_id
      AND _date BETWEEN effective_from AND effective_to
  )
$$;

-- ============================================================
-- Ensure at least one OPEN pay period exists for current tenant
-- (so attendance can be logged immediately).
-- ============================================================
INSERT INTO public.pay_periods (tenant_id, label, start_date, end_date, pay_date, status)
SELECT
  t.id,
  to_char(date_trunc('month', CURRENT_DATE), 'Mon YYYY'),
  date_trunc('month', CURRENT_DATE)::date,
  (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
  (date_trunc('month', CURRENT_DATE) + interval '1 month + 15 days')::date,
  'open'::public.pay_period_status
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.pay_periods pp
  WHERE pp.tenant_id = t.id
    AND CURRENT_DATE BETWEEN pp.start_date AND pp.end_date
);

-- ============================================================
-- Audit trigger on ps_exemptions
-- ============================================================
CREATE TRIGGER trg_audit_ps_exemptions
  AFTER INSERT OR UPDATE OR DELETE ON public.ps_exemptions
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_event();
