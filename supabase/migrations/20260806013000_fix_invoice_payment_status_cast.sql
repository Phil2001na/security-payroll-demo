-- Bug found in Round 7 verify-tracker (#14): sync_invoice_payment_status() (added by
-- 20260803153900) assigns bare 'paid'/'issued' string literals to the invoices.status enum
-- column inside a CASE expression. Postgres resolves that CASE as type text (neither branch
-- gives it an enum hint) and rejects the implicit cast, so every invoice_payments insert/update/
-- delete has failed with a 400 since the trigger was created. Fix: cast the literals explicitly.

create or replace function public.sync_invoice_payment_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_invoice uuid := coalesce(new.invoice_id, old.invoice_id); v_total numeric; v_paid numeric;
begin
  select total into v_total from public.invoices where id = v_invoice;
  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = v_invoice;
  if v_paid > v_total then raise exception 'Payments exceed invoice total'; end if;
  update public.invoices set status = case when v_paid = v_total then 'paid'::invoice_status else 'issued'::invoice_status end,
    paid_at = case when v_paid = v_total then now() else null end where id = v_invoice;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
