-- Align ledger posting with this project's actual chart of accounts and
-- provision the few accounts the AR/AP/payroll flows require.
-- This project's chart of accounts:
--   1001 Cash at Bank, 1100 Accounts Receivable, 2100 Wages Payable,
--   2200 PAYE Tax Payable, 2300 SSC Contributions Payable,
--   4000 Security Services Revenue, 5000 Salaries & Wages Expense,
--   5100 SSC Employer Contribution, 5200 Transport Allowances,
--   5300 Uniform & Equipment, 5400 Night & Premium Pay
-- Added here: 2400 Accounts Payable, 2500 VAT Control,
--   2600 Other Payroll Deductions, 5900 General Operating Expenses.

ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_tenant_code_key;
ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_tenant_code_key UNIQUE (tenant_id, code);

INSERT INTO public.chart_of_accounts (tenant_id, name, type, code, normal_balance)
SELECT t.id, x.name, x.type::public.account_type, x.code, x.nb::public.normal_balance_type
FROM public.tenants t
CROSS JOIN (VALUES
  ('2400','Accounts Payable','liability','credit'),
  ('2500','VAT Control','liability','credit'),
  ('2600','Other Payroll Deductions','liability','credit'),
  ('5900','General Operating Expenses','expense','debit')
) AS x(code,name,type,nb)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- AR: 1100 AR / 4000 Revenue / 2500 VAT ; cash 1001
-- AP: 5900 Opex / 2500 VAT / 2400 AP ; cash 1001
CREATE OR REPLACE FUNCTION public.fn_post_invoice_to_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;

DROP TRIGGER IF EXISTS trg_post_invoice_to_ledger ON public.invoices;
CREATE TRIGGER trg_post_invoice_to_ledger
AFTER INSERT OR UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.fn_post_invoice_to_ledger();

-- gross -> 5000 Wages ; PAYE 2200 ; SSC 2300 ; other 2600 ; net 2100 Wages Payable
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
END; $$;

DROP TRIGGER IF EXISTS trg_post_payroll_to_ledger ON public.payroll_runs;
CREATE TRIGGER trg_post_payroll_to_ledger
AFTER UPDATE OF status ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.fn_post_payroll_to_ledger();
