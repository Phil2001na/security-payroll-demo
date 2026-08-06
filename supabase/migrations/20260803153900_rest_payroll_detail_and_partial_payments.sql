-- Client-approved follow-up: ten rest days are mandatory; save Sunday call-ins
-- distinctly; and record each receipt rather than treating an invoice as all-or-nothing.

alter table public.payroll_runs
  add column if not exists sunday_callin_hours numeric not null default 0,
  add column if not exists sunday_callin_amount numeric not null default 0;

create or replace function public.enforce_minimum_monthly_rest_days()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_worked integer;
  v_days integer;
  v_is_work boolean;
  v_month_start date := date_trunc('month', new.date)::date;
  v_month_end date := (date_trunc('month', new.date) + interval '1 month - 1 day')::date;
begin
  select pay_rule not in ('off', 'leave') into v_is_work from public.shift_types where id = new.shift_type_id;
  if not coalesce(v_is_work, true) then return new; end if;
  select count(distinct sa.date) into v_worked
    from public.schedule_assignments sa
    join public.shift_types st on st.id = sa.shift_type_id
   where sa.employee_id = new.employee_id
     and sa.date between v_month_start and v_month_end
     and st.pay_rule not in ('off', 'leave')
     and sa.id <> new.id;
  v_worked := coalesce(v_worked, 0) + 1;
  v_days := (v_month_end - v_month_start) + 1;
  if v_days - v_worked < 10 then
    raise exception 'Minimum rest breached: this would leave the guard with % off days in % (minimum 10)',
      v_days - v_worked, to_char(v_month_start, 'Mon YYYY') using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists schedule_assignments_minimum_rest_days on public.schedule_assignments;
create trigger schedule_assignments_minimum_rest_days
  before insert or update of employee_id, date, shift_type_id on public.schedule_assignments
  for each row execute function public.enforce_minimum_monthly_rest_days();

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  received_at timestamptz not null default now(),
  amount numeric(12,2) not null check (amount > 0),
  reference text,
  notes text,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists invoice_payments_invoice_received_idx on public.invoice_payments(invoice_id, received_at);
alter table public.invoice_payments enable row level security;
create policy invoice_payments_select on public.invoice_payments for select to authenticated using (tenant_id = get_my_tenant_id());
create policy invoice_payments_insert on public.invoice_payments for insert to authenticated with check (tenant_id = get_my_tenant_id() and get_my_role() = any(array['admin','accountant']));

-- Preserve historical fully-paid invoices as one receipt, then derive status from receipts.
insert into public.invoice_payments (tenant_id, invoice_id, received_at, amount, reference)
select i.tenant_id, i.id, coalesce(i.paid_at, i.updated_at, now()), i.total, 'Migrated paid invoice'
from public.invoices i
where i.status = 'paid' and i.total > 0
  and not exists (select 1 from public.invoice_payments p where p.invoice_id = i.id);

create or replace function public.sync_invoice_payment_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_invoice uuid := coalesce(new.invoice_id, old.invoice_id); v_total numeric; v_paid numeric;
begin
  select total into v_total from public.invoices where id = v_invoice;
  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = v_invoice;
  if v_paid > v_total then raise exception 'Payments exceed invoice total'; end if;
  update public.invoices set status = case when v_paid = v_total then 'paid' else 'issued' end,
    paid_at = case when v_paid = v_total then now() else null end where id = v_invoice;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger invoice_payments_sync_status after insert or update or delete on public.invoice_payments
for each row execute function public.sync_invoice_payment_status();
