-- Accounting + invoicing foundation

CREATE TABLE public.ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_ledger_accounts_tenant ON public.ledger_accounts(tenant_id);
CREATE TRIGGER trg_ledger_accounts_touch BEFORE UPDATE ON public.ledger_accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_entries_tenant_date ON public.ledger_entries(tenant_id, entry_date);
CREATE TRIGGER trg_ledger_entries_touch BEFORE UPDATE ON public.ledger_entries FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ledger_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES public.ledger_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.ledger_accounts(id),
  debit NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ledger_line_non_negative CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT chk_ledger_line_one_side CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);
CREATE INDEX idx_ledger_lines_ledger ON public.ledger_lines(ledger_id);

CREATE OR REPLACE FUNCTION public.enforce_balanced_ledger_entry()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_ledger_id UUID;
  v_debit NUMERIC(14,2);
  v_credit NUMERIC(14,2);
BEGIN
  v_ledger_id := COALESCE(NEW.ledger_id, OLD.ledger_id);

  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0)
  INTO v_debit, v_credit
  FROM public.ledger_lines
  WHERE ledger_id = v_ledger_id;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Unbalanced ledger entry %: debit % != credit %', v_ledger_id, v_debit, v_credit;
  END IF;

  IF v_debit = 0 OR v_credit = 0 THEN
    RAISE EXCEPTION 'Ledger entry % must include non-zero debit and credit lines', v_ledger_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ledger_lines_balanced
AFTER INSERT OR UPDATE OR DELETE ON public.ledger_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_balanced_ledger_entry();

CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id),
  pay_period_id UUID REFERENCES public.pay_periods(id),
  invoice_number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_tenant_site ON public.invoices(tenant_id, site_id);
CREATE TRIGGER trg_invoices_touch BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  shift_log_id UUID REFERENCES public.shift_logs(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity_hours NUMERIC(8,2) NOT NULL,
  unit_rate NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_items_invoice ON public.invoice_items(invoice_id);

CREATE OR REPLACE FUNCTION public.recalculate_invoice_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.invoices i
  SET total_amount = COALESCE((
    SELECT SUM(ii.line_total) FROM public.invoice_items ii WHERE ii.invoice_id = i.id
  ), 0)
  WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_invoice_items_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.recalculate_invoice_total();
