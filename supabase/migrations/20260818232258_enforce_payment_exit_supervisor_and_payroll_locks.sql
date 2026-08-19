-- Serialize payment totals for an invoice. The parent row lock makes concurrent
-- payment inserts queue before checking the aggregate amount.
create or replace function public.sync_invoice_payment_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_total numeric;
  v_paid numeric;
begin
  select total into v_total from public.invoices where id = v_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.invoice_payments where invoice_id = v_invoice;
  if v_paid > v_total then raise exception 'Payments exceed invoice total'; end if;

  update public.invoices
  set status = case when v_paid = v_total then 'paid'::public.invoice_status else 'issued'::public.invoice_status end,
      paid_at = case when v_paid = v_total then now() else null end
  where id = v_invoice and status <> 'void';
  return coalesce(new, old);
end $$;

-- A field supervisor can only report a non-monetary incident for a guard at a
-- site assigned to that supervisor; management roles retain their existing scope.
drop policy if exists disciplinary_actions_role_insert on public.disciplinary_actions;
create policy disciplinary_actions_role_insert on public.disciplinary_actions
  as restrictive for insert to authenticated
  with check (
    public.get_my_role() = any (array['admin', 'operations', 'supervisor', 'payroll'])
    or (
      public.get_my_role() = 'security_supervisor'
      and action_type in ('verbal_warning', 'written_warning', 'final_warning')
      and coalesce(fine_amount, 0) = 0
      and coalesce(suspension_hours, 0) = 0
      and exists (
        select 1 from public.employees employee
        where employee.id = disciplinary_actions.employee_id
          and employee.tenant_id = public.get_my_tenant_id()
          and employee.home_site_id = any(public.current_site_ids())
      )
    )
  );

-- Employment-exit transitions are implemented by SECURITY DEFINER RPCs that
-- enforce the recorded -> verified -> confirmed/cancelled state machine. Direct
-- PostgREST updates bypassed that state machine, so remove their RLS path.
drop policy if exists employment_exits_role_update on public.employment_exits;
drop policy if exists employment_exits_update on public.employment_exits;

-- Match finalize_payroll_period's lock before replacing drafts, preventing a
-- concurrent writer from deleting/recreating draft rows after finalization.
create or replace function public.replace_draft_payroll(p_period uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role not in ('payroll','admin') then raise exception 'Not authorized to run payroll'; end if;
  perform 1 from public.pay_periods
  where id=p_period and tenant_id=v_tenant and status='open'
  for update;
  if not found then raise exception 'Open payroll period not found'; end if;

  delete from public.payroll_runs where pay_period_id=p_period and status='draft' and tenant_id=v_tenant;
  insert into public.payroll_runs (
    tenant_id,employee_id,pay_period_id,normal_hours,overtime_hours,sunday_hours,sunday_callin_hours,
    public_holiday_hours,night_hours,annual_leave_hours,sick_leave_hours,compassionate_leave_hours,maternity_leave_hours,maternity_paid_hours,unpaid_leave_hours,
    rate_per_hour,normal_amount,overtime_amount,sunday_amount,sunday_callin_amount,public_holiday_amount,
    night_premium_amount,transport_allowance,gross_salary,paye_amount,ssc_amount,consensual_deductions,
    total_deductions,net_salary,compliance_warnings,status)
  select v_tenant,(r->>'employee_id')::uuid,p_period,
    coalesce((r->>'normal_hours')::numeric,0),coalesce((r->>'overtime_hours')::numeric,0),
    coalesce((r->>'sunday_hours')::numeric,0),coalesce((r->>'sunday_callin_hours')::numeric,0),
    coalesce((r->>'public_holiday_hours')::numeric,0),coalesce((r->>'night_hours')::numeric,0),
    coalesce((r->>'annual_leave_hours')::numeric,0),coalesce((r->>'sick_leave_hours')::numeric,0),
    coalesce((r->>'compassionate_leave_hours')::numeric,0),coalesce((r->>'maternity_leave_hours')::numeric,0),
    coalesce((r->>'maternity_paid_hours')::numeric,0),coalesce((r->>'unpaid_leave_hours')::numeric,0),
    (r->>'rate_per_hour')::numeric,coalesce((r->>'normal_amount')::numeric,0),
    coalesce((r->>'overtime_amount')::numeric,0),coalesce((r->>'sunday_amount')::numeric,0),
    coalesce((r->>'sunday_callin_amount')::numeric,0),coalesce((r->>'public_holiday_amount')::numeric,0),
    coalesce((r->>'night_premium_amount')::numeric,0),coalesce((r->>'transport_allowance')::numeric,0),
    coalesce((r->>'gross_salary')::numeric,0),coalesce((r->>'paye_amount')::numeric,0),
    coalesce((r->>'ssc_amount')::numeric,0),coalesce((r->>'consensual_deductions')::numeric,0),
    coalesce((r->>'total_deductions')::numeric,0),coalesce((r->>'net_salary')::numeric,0),
    coalesce(r->'compliance_warnings','[]'::jsonb),'draft'
  from jsonb_array_elements(p_rows) r;
end $$;
