-- The billing Edge Function now requires pay_period_id. This database-level
-- backstop makes retries and concurrent requests incapable of producing two
-- live AR invoices for the same site and period. It intentionally fails before
-- applying if historic duplicate live invoices exist, so they can be reviewed
-- rather than silently merged or deleted.
create unique index invoices_one_live_ar_invoice_per_site_period
  on public.invoices (tenant_id, site_id, pay_period_id)
  where type = 'AR' and pay_period_id is not null and status <> 'void';
