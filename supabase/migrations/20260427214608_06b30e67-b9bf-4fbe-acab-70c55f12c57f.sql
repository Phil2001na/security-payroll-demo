-- Enum for shift kind used by manpower requirements
DO $$ BEGIN
  CREATE TYPE public.shift_kind AS ENUM ('day', 'night');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enum for employee shift preference
DO $$ BEGIN
  CREATE TYPE public.shift_preference AS ENUM ('day', 'night', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add preferred_shift to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS preferred_shift public.shift_preference NOT NULL DEFAULT 'both';

-- Site manpower requirements table
CREATE TABLE IF NOT EXISTS public.site_requirements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_id UUID NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  shift_kind public.shift_kind NOT NULL,
  quantity_required INTEGER NOT NULL DEFAULT 0 CHECK (quantity_required >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, day_of_week, shift_kind)
);

CREATE INDEX IF NOT EXISTS idx_site_requirements_site ON public.site_requirements(site_id);
CREATE INDEX IF NOT EXISTS idx_site_requirements_tenant ON public.site_requirements(tenant_id);

ALTER TABLE public.site_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_requirements_admin_ops_all ON public.site_requirements;
CREATE POLICY site_requirements_admin_ops_all ON public.site_requirements
  FOR ALL
  USING (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin_or_ops());

DROP POLICY IF EXISTS site_requirements_supervisor_read ON public.site_requirements;
CREATE POLICY site_requirements_supervisor_read ON public.site_requirements
  FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND (site_id = ANY(public.current_site_ids()) OR public.has_role('viewer'::public.app_role)));

DROP TRIGGER IF EXISTS site_requirements_touch ON public.site_requirements;
CREATE TRIGGER site_requirements_touch
  BEFORE UPDATE ON public.site_requirements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();