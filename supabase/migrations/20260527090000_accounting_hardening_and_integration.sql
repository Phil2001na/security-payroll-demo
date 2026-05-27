-- ============================================================================
-- Accounting hardening & cross-module integration
-- Fixes: correct double-entry posting (AR/AP/tax/payment/void), payroll->ledger,
-- deferred balance check, FK protection on financial history, accountant access,
-- billing rate column, missing indexes, payroll integrity constraint.
-- ============================================================================

-- ---------- C1: client billing rate on sites ----------
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS billing_rate numeric(10,2) NOT NULL DEFAULT 0;

-- ---------- T1: index foreign keys used by accounting reads ----------
CREATE INDEX IF NOT EXISTS idx_ledger_lines_ledger   ON public.ledger_lines(ledger_id);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_account  ON public.ledger_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_lines_tenant   ON public.ledger_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_tenant ON public.ledger_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_ref    ON public.ledger_entries(reference_id, reference_type);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status ON public.invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_client       ON public.invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);

-- ---------- T2: protect financial history from employee deletion ----------
ALTER TABLE public.payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_employee_id_fkey;
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;

ALTER TABLE public.deductions DROP CONSTRAINT IF EXISTS deductions_employee_id_fkey;
ALTER TABLE public.deductions
  ADD CONSTRAINT deductions_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;

-- ---------- C6: payroll integrity (net must equal gross minus deductions) ----------
-- NOT VALID: enforced on new/updated rows; existing rows are not retro-checked.
ALTER TABLE public.payroll_runs DROP CONSTRAINT IF EXISTS chk_payroll_net;
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT chk_payroll_net
  CHECK (net_salary = gross_salary - total_deductions) NOT VALID;

-- ---------- A2: accountant can read sites (invoices reference sites as clients) ----------
DROP POLICY IF EXISTS "sites_accountant_read" ON public.sites;
CREATE POLICY "sites_accountant_read" ON public.sites FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND public.current_role() = 'accountant');

-- ---------- Standard chart of accounts helper (auto-provisions per tenant) ----------
CREATE OR REPLACE FUNCTION public.fn_get_or_create_account(
  p_tenant uuid, p_code char(4), p_name text,
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

-- Seed the standard chart for existing tenants
DO $$
DECLARE t uuid;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.fn_get_or_create_account(t,'1000','Cash & Bank','asset','debit');
    PERFORM public.fn_get_or_create_account(t,'1100','Accounts Receivable','asset','debit');
    PERFORM public.fn_get_or_create_account(t,'2100','Accounts Payable','liability','credit');
    PERFORM public.fn_get_or_create_account(t,'2200','VAT Control','liability','credit');
    PERFORM public.fn_get_or_create_account(t,'2300','PAYE Payable','liability','credit');
    PERFORM public.fn_get_or_create_account(t,'2400','SSC Payable','liability','credit');
    PERFORM public.fn_get_or_create_account(t,'2500','Net Wages Payable','liability','credit');
    PERFORM public.fn_get_or_create_account(t,'2600','Other Payroll Deductions','liability','credit');
    PERFORM public.fn_get_or_create_account(t,'4100','Service Revenue','income','credit');
    PERFORM public.fn_get_or_create_account(t,'5100','Operating Expenses','expense','debit');
    PERFORM public.fn_get_or_create_account(t,'6100','Wages Expense','expense','debit');
  END LOOP;
END $$;

-- ---------- A4: deferred ledger balance check (validates at COMMIT) ----------
CREATE OR REPLACE FUNCTION public.fn_check_ledger_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ledger_id uuid;
  v_debits numeric(14,2);
  v_credits numeric(14,2);
BEGIN
  v_ledger_id := COALESCE(NEW.ledger_id, OLD.ledger_id);
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_debits, v_credits
  FROM public.ledger_lines
  WHERE ledger_id = v_ledger_id;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Ledger % is unbalanced. Debits: %, Credits: %', v_ledger_id, v_debits, v_credits;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_check_ledger_balance ON public.ledger_lines;
CREATE CONSTRAINT TRIGGER trg_check_ledger_balance
AFTER INSERT OR UPDATE OR DELETE ON public.ledger_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.fn_check_ledger_balance();

-- ---------- Invoice total derived from line items (+ tax) ----------
CREATE OR REPLACE FUNCTION public.fn_recalc_invoice_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invoice uuid; v_subtotal numeric(14,2);
BEGIN
  v_invoice := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_subtotal
  FROM public.invoice_items WHERE invoice_id = v_invoice;
  UPDATE public.invoices SET total = v_subtotal + COALESCE(tax, 0) WHERE id = v_invoice;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_recalc_invoice_total ON public.invoice_items;
CREATE TRIGGER trg_recalc_invoice_total
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.fn_recalc_invoice_total();

-- ---------- C4: correct double-entry invoice posting (AR/AP, tax, payment, void) ----------
CREATE OR REPLACE FUNCTION public.fn_post_invoice_to_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ledger uuid;
  v_total numeric(14,2);
  v_tax numeric(14,2);
  v_net numeric(14,2);
  v_old public.invoice_status;
BEGIN
  v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  v_total := COALESCE(NEW.total, 0);
  v_tax   := COALESCE(NEW.tax, 0);
  v_net   := v_total - v_tax;

  -- ISSUED / RECEIVED
  IF NEW.status = 'issued' AND v_old IS DISTINCT FROM 'issued' AND v_total > 0 THEN
    INSERT INTO public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    VALUES (NEW.tenant_id, COALESCE(NEW.issued_at::date, CURRENT_DATE),
            CASE WHEN NEW.type = 'AR' THEN 'AR invoice issued' ELSE 'AP invoice received' END,
            NEW.id, 'invoice_issue')
    RETURNING id INTO v_ledger;

    IF NEW.type = 'AR' THEN
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'1100','Accounts Receivable','asset','debit'), v_total, 0);
      IF v_net > 0 THEN
        INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'4100','Service Revenue','income','credit'), 0, v_net);
      END IF;
      IF v_tax > 0 THEN
        INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2200','VAT Control','liability','credit'), 0, v_tax);
      END IF;
    ELSE -- AP
      IF v_net > 0 THEN
        INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'5100','Operating Expenses','expense','debit'), v_net, 0);
      END IF;
      IF v_tax > 0 THEN
        INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2200','VAT Control','liability','credit'), v_tax, 0);
      END IF;
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2100','Accounts Payable','liability','credit'), 0, v_total);
    END IF;
  END IF;

  -- PAID
  IF NEW.status = 'paid' AND v_old IS DISTINCT FROM 'paid' AND v_total > 0 THEN
    INSERT INTO public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    VALUES (NEW.tenant_id, COALESCE(NEW.paid_at::date, CURRENT_DATE),
            CASE WHEN NEW.type = 'AR' THEN 'AR payment received' ELSE 'AP payment made' END,
            NEW.id, 'invoice_payment')
    RETURNING id INTO v_ledger;

    IF NEW.type = 'AR' THEN
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit) VALUES
        (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'1000','Cash & Bank','asset','debit'), v_total, 0),
        (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'1100','Accounts Receivable','asset','debit'), 0, v_total);
    ELSE
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit) VALUES
        (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2100','Accounts Payable','liability','credit'), v_total, 0),
        (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'1000','Cash & Bank','asset','debit'), 0, v_total);
    END IF;
  END IF;

  -- VOID (reverse the original issue entry)
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
END; $$;

-- Fire on INSERT (covers invoices created already-issued) and on status change.
DROP TRIGGER IF EXISTS trg_post_invoice_to_ledger ON public.invoices;
CREATE TRIGGER trg_post_invoice_to_ledger
AFTER INSERT OR UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.fn_post_invoice_to_ledger();

-- ---------- A1: post finalized payroll to the general ledger ----------
CREATE OR REPLACE FUNCTION public.fn_post_payroll_to_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ledger uuid; v_other numeric(14,2);
BEGIN
  IF NEW.status = 'finalized' AND OLD.status IS DISTINCT FROM 'finalized' AND NEW.gross_salary > 0 THEN
    v_other := NEW.total_deductions - NEW.paye_amount - NEW.ssc_amount;

    INSERT INTO public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    VALUES (NEW.tenant_id, COALESCE(NEW.finalized_at::date, CURRENT_DATE), 'Payroll finalized', NEW.id, 'payroll_run')
    RETURNING id INTO v_ledger;

    INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
    VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'6100','Wages Expense','expense','debit'), NEW.gross_salary, 0);

    IF NEW.paye_amount > 0 THEN
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2300','PAYE Payable','liability','credit'), 0, NEW.paye_amount);
    END IF;
    IF NEW.ssc_amount > 0 THEN
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2400','SSC Payable','liability','credit'), 0, NEW.ssc_amount);
    END IF;
    IF v_other > 0 THEN
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2600','Other Payroll Deductions','liability','credit'), 0, v_other);
    END IF;
    IF NEW.net_salary > 0 THEN
      INSERT INTO public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      VALUES (NEW.tenant_id, v_ledger, public.fn_get_or_create_account(NEW.tenant_id,'2500','Net Wages Payable','liability','credit'), 0, NEW.net_salary);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_post_payroll_to_ledger ON public.payroll_runs;
CREATE TRIGGER trg_post_payroll_to_ledger
AFTER UPDATE OF status ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.fn_post_payroll_to_ledger();

-- ---------- A3: atomic payroll draft replace + finalize ----------
CREATE OR REPLACE FUNCTION public.replace_draft_payroll(p_period uuid, p_rows jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL OR NOT public.is_admin_or_ops() THEN
    RAISE EXCEPTION 'Not authorized to run payroll';
  END IF;

  DELETE FROM public.payroll_runs
   WHERE pay_period_id = p_period AND status = 'draft' AND tenant_id = v_tenant;

  INSERT INTO public.payroll_runs (
    tenant_id, employee_id, pay_period_id, normal_hours, overtime_hours, sunday_hours,
    public_holiday_hours, night_hours, rate_per_hour, normal_amount, overtime_amount,
    sunday_amount, public_holiday_amount, night_premium_amount, transport_allowance,
    gross_salary, paye_amount, ssc_amount, consensual_deductions, total_deductions,
    net_salary, compliance_warnings, status)
  SELECT
    v_tenant, (r->>'employee_id')::uuid, p_period,
    (r->>'normal_hours')::numeric, (r->>'overtime_hours')::numeric, (r->>'sunday_hours')::numeric,
    (r->>'public_holiday_hours')::numeric, (r->>'night_hours')::numeric, (r->>'rate_per_hour')::numeric,
    (r->>'normal_amount')::numeric, (r->>'overtime_amount')::numeric, (r->>'sunday_amount')::numeric,
    (r->>'public_holiday_amount')::numeric, (r->>'night_premium_amount')::numeric, (r->>'transport_allowance')::numeric,
    (r->>'gross_salary')::numeric, (r->>'paye_amount')::numeric, (r->>'ssc_amount')::numeric,
    (r->>'consensual_deductions')::numeric, (r->>'total_deductions')::numeric, (r->>'net_salary')::numeric,
    COALESCE(r->'compliance_warnings', '[]'::jsonb), 'draft'
  FROM jsonb_array_elements(p_rows) AS r;
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_payroll_period(p_period uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL OR NOT public.is_admin_or_ops() THEN
    RAISE EXCEPTION 'Not authorized to finalize payroll';
  END IF;

  -- Finalize runs first (this posts to the ledger) while the period is still editable,
  -- then lock the period.
  UPDATE public.payroll_runs
     SET status = 'finalized', finalized_at = now()
   WHERE pay_period_id = p_period AND status = 'draft' AND tenant_id = v_tenant;

  UPDATE public.pay_periods
     SET status = 'locked', locked_at = now(), locked_by = auth.uid()
   WHERE id = p_period AND tenant_id = v_tenant;
END; $$;
