-- 1. Tenant-level default contract
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS default_contract_terms TEXT;

-- 2. Per-site contract override
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS contract_terms_text TEXT;

-- 3. Signed agreements table
CREATE TABLE IF NOT EXISTS public.signed_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  site_id UUID,
  contract_snapshot TEXT NOT NULL,
  signature_url TEXT NOT NULL,
  id_document_url TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_ip TEXT,
  signed_by_supervisor UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.signed_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signed_agreements_admin_ops_all"
  ON public.signed_agreements FOR ALL
  USING (tenant_id = current_tenant_id() AND is_admin_or_ops())
  WITH CHECK (tenant_id = current_tenant_id() AND is_admin_or_ops());

CREATE POLICY "signed_agreements_employee_read_own"
  ON public.signed_agreements FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.employees e
      JOIN auth.users u ON lower(u.email) = lower(e.email)
      WHERE e.id = signed_agreements.employee_id AND u.id = auth.uid()
    )
  );

CREATE TRIGGER signed_agreements_touch_updated_at
  BEFORE UPDATE ON public.signed_agreements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Private storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('onboarding', 'onboarding', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage policies (files keyed by employee_id as first folder)
CREATE POLICY "onboarding_admin_ops_all"
  ON storage.objects FOR ALL
  USING (bucket_id = 'onboarding' AND is_admin_or_ops())
  WITH CHECK (bucket_id = 'onboarding' AND is_admin_or_ops());

CREATE POLICY "onboarding_employee_read_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'onboarding'
    AND EXISTS (
      SELECT 1 FROM public.employees e
      JOIN auth.users u ON lower(u.email) = lower(e.email)
      WHERE e.id::text = (storage.foldername(name))[1]
        AND u.id = auth.uid()
    )
  );