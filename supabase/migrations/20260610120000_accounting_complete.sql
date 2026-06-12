-- ============================================================================
-- Accounting completion: tenant billing profile, AP/vendors, invoice numbering,
-- tax + total recalc, double-entry ledger posting, payroll->ledger.
-- Multi-tenant, adapted to this project's get_my_tenant_id() world.
-- Additive & non-destructive.
-- NOTE: ledger account codes are corrected to this project's real chart of
-- accounts in the follow-up migration 20260610120100_accounting_complete_coa_fix.
-- ============================================================================

-- ---------- generic updated_at helper ----------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

-- ---------- 1. Tenant billing / bank / branding profile ----------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS registered_address   text,
  ADD COLUMN IF NOT EXISTS vat_number           text,
  ADD COLUMN IF NOT EXISTS company_phone        text,
  ADD COLUMN IF NOT EXISTS company_email        text,
  ADD COLUMN IF NOT EXISTS company_website      text,
  ADD COLUMN IF NOT EXISTS logo_url             text,
  ADD COLUMN IF NOT EXISTS bank_name            text,
  ADD COLUMN IF NOT EXISTS bank_account_name    text,
  ADD COLUMN IF NOT EXISTS bank_account_number  text,
  ADD COLUMN IF NOT EXISTS bank_branch_name     text,
  ADD COLUMN IF NOT EXISTS bank_branch_code     text,
  ADD COLUMN IF NOT EXISTS default_tax_rate     numeric(5,4) NOT NULL DEFAULT 0.15,
  ADD COLUMN IF NOT EXISTS invoice_due_days     integer      NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS invoice_penalty_note text,
  ADD COLUMN IF NOT EXISTS invoice_footer_note  text;

DROP TRIGGER IF EXISTS trg_tenants_touch ON public.tenants;
CREATE TRIGGER trg_tenants_touch BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- 2. Vendors (AP suppliers) ----------
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_email text,
  phone text,
  address text,
  vat_number text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendors_tenant ON public.vendors(tenant_id);

DROP TRIGGER IF EXISTS trg_vendors_touch ON public.vendors;
CREATE TRIGGER trg_vendors_touch BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendors_select ON public.vendors;
DROP POLICY IF EXISTS vendors_insert ON public.vendors;
DROP POLICY IF EXISTS vendors_update ON public.vendors;
DROP POLICY IF EXISTS vendors_delete ON public.vendors;
CREATE POLICY vendors_select ON public.vendors FOR SELECT USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY vendors_insert ON public.vendors FOR INSERT WITH CHECK (tenant_id = public.get_my_tenant_id());
CREATE POLICY vendors_update ON public.vendors FOR UPDATE USING (tenant_id = public.get_my_tenant_id()) WITH CHECK (tenant_id = public.get_my_tenant_id());
CREATE POLICY vendors_delete ON public.vendors FOR DELETE USING (tenant_id = public.get_my_tenant_id());

-- ---------- 3. Invoices: AP support, invoice_date, tax on items ----------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vendor_id    uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS invoice_date date;

UPDATE public.invoices SET invoice_date = COALESCE(invoice_date, created_at::date) WHERE invoice_date IS NULL;
ALTER TABLE public.invoices ALTER COLUMN invoice_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.invoices ALTER COLUMN invoice_date SET NOT NULL;

ALTER TABLE public.invoices ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS chk_invoice_party;
ALTER TABLE public.invoices
  ADD CONSTRAINT chk_invoice_party CHECK (
    (type = 'AR' AND client_id IS NOT NULL) OR
    (type = 'AP' AND vendor_id IS NOT NULL)
  ) NOT VALID;
ALTER TABLE public.invoices VALIDATE CONSTRAINT chk_invoice_party;

DROP TRIGGER IF EXISTS trg_invoices_touch ON public.invoices;
CREATE TRIGGER trg_invoices_touch BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,4) NOT NULL DEFAULT 0.15;
UPDATE public.invoice_items SET tax_rate = 0 WHERE invoice_id IN (
  SELECT id FROM public.invoices WHERE created_at < now()
);

-- ---------- 4. Chart-of-accounts auto-provision helper ----------
CREATE OR REPLACE FUNCTION public.fn_get_or_create_account(
  p_tenant uuid, p_code text, p_name text,
  p_type public.account_type, p_normal public.normal_balance_type
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;

-- ---------- 5. Invoice total = subtotal + tax (tax derived per line) ----------
CREATE OR REPLACE FUNCTION public.fn_recalc_invoice_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;

DROP TRIGGER IF EXISTS trg_recalc_invoice_total ON public.invoice_items;
CREATE TRIGGER trg_recalc_invoice_total
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.fn_recalc_invoice_total();

-- ---------- 6. Invoice numbering (AR only): INV/YYYY/NNNNN ----------
CREATE OR REPLACE FUNCTION public.fn_assign_invoice_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;

DROP TRIGGER IF EXISTS trg_assign_invoice_number ON public.invoices;
CREATE TRIGGER trg_assign_invoice_number
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.fn_assign_invoice_number();

-- ---------- 7. Deferred ledger balance check ----------
CREATE OR REPLACE FUNCTION public.fn_check_ledger_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ledger uuid; v_d numeric(14,2); v_c numeric(14,2);
BEGIN
  v_ledger := COALESCE(NEW.ledger_id, OLD.ledger_id);
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO v_d, v_c
  FROM public.ledger_lines WHERE ledger_id = v_ledger;
  IF v_d <> v_c THEN
    RAISE EXCEPTION 'Ledger % is unbalanced. Debits %, Credits %', v_ledger, v_d, v_c;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_check_ledger_balance ON public.ledger_lines;
CREATE CONSTRAINT TRIGGER trg_check_ledger_balance
AFTER INSERT OR UPDATE OR DELETE ON public.ledger_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.fn_check_ledger_balance();

-- ---------- 8/9. Posting functions: see follow-up coa_fix migration ----------
