-- Seed the demo tenant (Apex Shield Security) billing profile, client addresses
-- and a few AP vendors so invoices render completely out of the box.
-- All values are editable in Admin → Settings; nothing is hardcoded in the app.

UPDATE public.tenants SET
  legal_name          = COALESCE(legal_name, 'Apex Shield Security (Pty) Ltd'),
  registered_address  = COALESCE(registered_address, 'Erf 2025, Sam Nujoma Drive'||chr(10)||'Windhoek 9000'||chr(10)||'Namibia'),
  vat_number          = COALESCE(vat_number, '7654321-01-9'),
  company_phone       = COALESCE(company_phone, '+264 61 300 100 / +264 81 555 0100'),
  company_email       = COALESCE(company_email, 'accounts@apexshield.com.na'),
  company_website     = COALESCE(company_website, 'https://www.apexshield.com.na'),
  bank_name           = COALESCE(bank_name, 'First National Bank'),
  bank_account_name   = COALESCE(bank_account_name, 'Apex Shield Security'),
  bank_account_number = COALESCE(bank_account_number, '62012345678'),
  bank_branch_name    = COALESCE(bank_branch_name, 'Windhoek Main Branch'),
  bank_branch_code    = COALESCE(bank_branch_code, '280172'),
  invoice_penalty_note= COALESCE(invoice_penalty_note, 'Please note that invoices not paid by the due date attract a 4% penalty fee.'),
  invoice_footer_note = COALESCE(invoice_footer_note, 'Send proof of payment to accounts@apexshield.com.na')
WHERE id = '11111111-0000-0000-0000-000000000001';

UPDATE public.sites SET
  client_name    = COALESCE(client_name, name),
  client_address = COALESCE(client_address, name||chr(10)||'Windhoek'||chr(10)||'Namibia')
WHERE tenant_id = '11111111-0000-0000-0000-000000000001';

INSERT INTO public.vendors (tenant_id, name, contact_email, phone, address, vat_number)
SELECT '11111111-0000-0000-0000-000000000001', v.name, v.email, v.phone, v.addr, v.vat
FROM (VALUES
  ('Namibia Uniform Suppliers cc', 'sales@namuniforms.na', '+264 61 222 333', 'Lazarett Street, Windhoek', '5551234-01-2'),
  ('SecureTech Equipment (Pty) Ltd', 'orders@securetech.na', '+264 61 444 555', 'Prosperita, Windhoek', '5559876-01-7'),
  ('City of Windhoek Municipality', 'billing@windhoekcc.org.na', '+264 61 290 2000', 'Independence Ave, Windhoek', NULL)
) AS v(name,email,phone,addr,vat)
WHERE NOT EXISTS (SELECT 1 FROM public.vendors WHERE tenant_id='11111111-0000-0000-0000-000000000001');
