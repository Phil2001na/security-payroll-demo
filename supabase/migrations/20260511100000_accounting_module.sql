-- Accounting & Invoicing module

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accountant';

CREATE TYPE public.account_type AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
CREATE TYPE public.normal_balance_type AS ENUM ('debit', 'credit');
CREATE TYPE public.invoice_type AS ENUM ('AR', 'AP');
CREATE TYPE public.invoice_status AS ENUM ('draft', 'issued', 'paid', 'void');

CREATE TABLE public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  type public.account_type NOT NULL,
  code char(4) NOT NULL CHECK (code ~ '^[0-9]{4}$'),
  normal_balance public.normal_balance_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER trg_chart_of_accounts_touch BEFORE UPDATE ON public.chart_of_accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  description text NOT NULL,
  reference_id uuid,
  reference_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ledger_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES public.ledger_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ledger_line_amount CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type public.invoice_type NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'draft',
  client_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  due_date date NOT NULL,
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_invoices_touch BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_check_ledger_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ledger_id uuid;
  v_debits numeric(14,2);
  v_credits numeric(14,2);
BEGIN
  FOR v_ledger_id IN
    SELECT DISTINCT ledger_id FROM new_rows
    UNION
    SELECT DISTINCT ledger_id FROM old_rows
  LOOP
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_debits, v_credits
    FROM public.ledger_lines
    WHERE ledger_id = v_ledger_id;

    IF v_debits <> v_credits THEN
      RAISE EXCEPTION 'Ledger % is unbalanced. Debits: %, Credits: %', v_ledger_id, v_debits, v_credits;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_check_ledger_balance
AFTER INSERT OR UPDATE OR DELETE ON public.ledger_lines
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.fn_check_ledger_balance();

CREATE OR REPLACE FUNCTION public.fn_post_invoice_to_ledger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ar_account uuid;
  v_revenue_account uuid;
  v_ledger_id uuid;
BEGIN
  IF NEW.status = 'issued' AND OLD.status IS DISTINCT FROM 'issued' THEN
    SELECT id INTO v_ar_account
    FROM public.chart_of_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '1100'
    LIMIT 1;

    SELECT id INTO v_revenue_account
    FROM public.chart_of_accounts
    WHERE tenant_id = NEW.tenant_id AND code = '4100'
    LIMIT 1;

    IF v_ar_account IS NULL OR v_revenue_account IS NULL THEN
      RAISE EXCEPTION 'Required accounts missing (1100 AR, 4100 Service Revenue) for tenant %', NEW.tenant_id;
    END IF;

    INSERT INTO public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    VALUES (NEW.tenant_id, COALESCE(NEW.issued_at::date, CURRENT_DATE), 'Invoice issued', NEW.id, 'invoice')
    RETURNING id INTO v_ledger_id;

    INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
    VALUES
      (NEW.tenant_id, v_ledger_id, v_ar_account, NEW.total, 0),
      (NEW.tenant_id, v_ledger_id, v_revenue_account, 0, NEW.total);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_post_invoice_to_ledger
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.fn_post_invoice_to_ledger();

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounting_select" ON public.chart_of_accounts FOR SELECT USING (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant'));
CREATE POLICY "accounting_insert" ON public.chart_of_accounts FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant'));
CREATE POLICY "accounting_update" ON public.chart_of_accounts FOR UPDATE USING (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant')) WITH CHECK (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant'));

CREATE POLICY "ledger_entries_all" ON public.ledger_entries FOR ALL USING (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant')) WITH CHECK (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant'));
CREATE POLICY "ledger_lines_all" ON public.ledger_lines FOR ALL USING (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant')) WITH CHECK (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant'));
CREATE POLICY "invoices_all" ON public.invoices FOR ALL USING (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant')) WITH CHECK (tenant_id = public.current_tenant_id() AND public.current_role() IN ('admin','accountant'));

CREATE POLICY "invoice_items_manage" ON public.invoice_items
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_id
      AND i.tenant_id = public.current_tenant_id()
      AND public.current_role() IN ('admin','accountant')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_id
      AND i.tenant_id = public.current_tenant_id()
      AND public.current_role() IN ('admin','accountant')
  )
);
