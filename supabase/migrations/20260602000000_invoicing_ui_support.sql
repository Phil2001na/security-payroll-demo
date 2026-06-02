-- Invoice number, period linkage, notes
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS pay_period_id  UUID REFERENCES pay_periods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes          TEXT;

ALTER TABLE invoices
  ADD CONSTRAINT IF NOT EXISTS invoices_number_tenant_unique UNIQUE (tenant_id, invoice_number);

CREATE OR REPLACE FUNCTION fn_assign_invoice_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_year TEXT := TO_CHAR(NOW(), 'YYYY');
  v_seq  INT;
BEGIN
  IF NEW.invoice_number IS NULL THEN
    SELECT COALESCE(
      MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INT)), 0
    ) + 1
      INTO v_seq
      FROM invoices
     WHERE tenant_id = NEW.tenant_id
       AND invoice_number LIKE 'INV-' || v_year || '-%';
    NEW.invoice_number := 'INV-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_invoice_number ON invoices;
CREATE TRIGGER trg_assign_invoice_number
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_assign_invoice_number();

-- Client contact details on sites (used on invoice header)
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS client_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS client_address       TEXT;
