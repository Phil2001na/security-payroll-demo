-- Invoice issue/void postings remain tied to invoice status. Payment postings
-- must instead be tied to each receipt so partial payments hit cash and AR/AP
-- on their actual receipt date.
create or replace function public.fn_post_invoice_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ledger uuid;
  v_total numeric(14,2);
  v_tax numeric(14,2);
  v_net numeric(14,2);
  v_old public.invoice_status;
begin
  v_old := case when tg_op = 'INSERT' then null else old.status end;
  v_total := coalesce(new.total, 0);
  v_tax := coalesce(new.tax, 0);
  v_net := v_total - v_tax;

  -- A payment has already posted cash/AR or cash/AP. Do not allow a silent
  -- invoice void to leave that receipt unreversed; refund handling needs its
  -- own explicit accounting workflow.
  if new.status = 'void' and v_old is distinct from 'void'
     and exists (select 1 from public.invoice_payments where invoice_id = new.id) then
    raise exception 'Cannot void an invoice with recorded payments; record a refund or credit first';
  end if;

  if new.status = 'issued' and v_old is distinct from 'issued' and v_total > 0 then
    insert into public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    values (
      new.tenant_id,
      coalesce(new.issued_at::date, new.invoice_date, current_date),
      case when new.type='AR' then 'AR invoice issued' else 'AP bill received' end,
      new.id,
      'invoice_issue'
    ) returning id into v_ledger;
    if new.type='AR' then
      insert into public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      values (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'1100','Accounts Receivable','asset','debit'), v_total, 0);
      if v_net > 0 then
        insert into public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        values (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'4000','Security Services Revenue','income','credit'), 0, v_net);
      end if;
      if v_tax > 0 then
        insert into public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        values (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'2500','VAT Control','liability','credit'), 0, v_tax);
      end if;
    else
      if v_net > 0 then
        insert into public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        values (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'5900','General Operating Expenses','expense','debit'), v_net, 0);
      end if;
      if v_tax > 0 then
        insert into public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
        values (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'2500','VAT Control','liability','credit'), v_tax, 0);
      end if;
      insert into public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
      values (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'2400','Accounts Payable','liability','credit'), 0, v_total);
    end if;
  end if;

  if new.status = 'void' and v_old is distinct from 'void' then
    insert into public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
    values (new.tenant_id, current_date, 'Invoice voided (reversal)', new.id, 'invoice_void')
    returning id into v_ledger;
    insert into public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit)
    select line.tenant_id, v_ledger, line.account_id, line.credit, line.debit
    from public.ledger_lines line
    join public.ledger_entries entry on entry.id = line.ledger_id
    where entry.reference_id = new.id and entry.reference_type = 'invoice_issue';
  end if;
  return new;
end $$;

create or replace function public.post_invoice_payment_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.invoices;
  v_ledger uuid;
begin
  select * into v_invoice from public.invoices where id = new.invoice_id;
  if not found then raise exception 'Invoice not found'; end if;
  if v_invoice.tenant_id <> new.tenant_id then raise exception 'Payment tenant does not match invoice tenant'; end if;
  if v_invoice.status = 'void' then raise exception 'Cannot post payment for a void invoice'; end if;

  insert into public.ledger_entries (tenant_id, entry_date, description, reference_id, reference_type)
  values (
    new.tenant_id,
    new.received_at::date,
    case when v_invoice.type = 'AR' then 'AR payment received' else 'AP payment made' end,
    new.id,
    'invoice_payment'
  ) returning id into v_ledger;

  if v_invoice.type = 'AR' then
    insert into public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit) values
      (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'1001','Cash at Bank','asset','debit'), new.amount, 0),
      (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'1100','Accounts Receivable','asset','debit'), 0, new.amount);
  else
    insert into public.ledger_lines (tenant_id, ledger_id, account_id, debit, credit) values
      (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'2400','Accounts Payable','liability','credit'), new.amount, 0),
      (new.tenant_id, v_ledger, public.fn_get_or_create_account(new.tenant_id,'1001','Cash at Bank','asset','debit'), 0, new.amount);
  end if;
  return new;
end $$;

drop trigger if exists trg_post_invoice_payment_to_ledger on public.invoice_payments;
create trigger trg_post_invoice_payment_to_ledger
  after insert on public.invoice_payments
  for each row execute function public.post_invoice_payment_to_ledger();

revoke all on function public.post_invoice_payment_to_ledger() from public, anon, authenticated;

-- Do not permit a client to mark an invoice paid without actual receipt rows.
-- The receipt trigger performs the same status transition after it has recorded
-- the final payment, so normal payment processing remains valid.
create or replace function public.ensure_invoice_paid_by_receipts()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_paid numeric;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = new.id;
    if v_paid <> new.total then
      raise exception 'Invoices may be marked paid only when recorded receipts equal the invoice total';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_invoice_paid_requires_receipts on public.invoices;
create trigger trg_invoice_paid_requires_receipts
  before update of status on public.invoices
  for each row execute function public.ensure_invoice_paid_by_receipts();

revoke all on function public.ensure_invoice_paid_by_receipts() from public, anon, authenticated;
