
-- Per-position contract templates on tenant
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS contract_template_officer text,
  ADD COLUMN IF NOT EXISTS contract_template_driver text,
  ADD COLUMN IF NOT EXISTS contract_template_management text;

-- Backfill from existing default if present
UPDATE public.tenants
SET contract_template_officer = COALESCE(contract_template_officer, default_contract_terms),
    contract_template_driver = COALESCE(contract_template_driver, default_contract_terms),
    contract_template_management = COALESCE(contract_template_management, default_contract_terms);

-- Track signed status on employee
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_signed_pdf_url text,
  ADD COLUMN IF NOT EXISTS contract_template_kind text;
