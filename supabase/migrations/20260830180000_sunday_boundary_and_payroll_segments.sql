-- UAT D-01/D-02 and P-06.  payroll_constants historically stores numeric values,
-- so value_text is additive and keeps every existing numeric consumer compatible.
alter table public.payroll_constants add column if not exists value_text text;
alter table public.payroll_runs add column if not exists calculation_segments jsonb not null default '[]'::jsonb;

insert into public.payroll_constants (tenant_id, key, value, value_text, description)
select t.id, 'sunday_boundary_rule', 0, 'midnight_split',
  'Sunday boundary calculation rule: midnight_split (default) or majority_of_shift'
from public.tenants t
where not exists (
  select 1 from public.payroll_constants pc
  where pc.tenant_id=t.id and pc.key='sunday_boundary_rule'
);

create or replace function public.replace_draft_payroll(p_period uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role not in ('payroll','admin') then raise exception 'Not authorized to run payroll'; end if;
  perform 1 from public.pay_periods where id=p_period and tenant_id=v_tenant and status='open' for update;
  if not found then raise exception 'Open payroll period not found'; end if;
  delete from public.payroll_runs where pay_period_id=p_period and status='draft' and tenant_id=v_tenant;
  insert into public.payroll_runs (
    tenant_id,employee_id,pay_period_id,normal_hours,overtime_hours,sunday_hours,sunday_callin_hours,
    public_holiday_hours,night_hours,annual_leave_hours,sick_leave_hours,compassionate_leave_hours,maternity_leave_hours,maternity_paid_hours,unpaid_leave_hours,
    rate_per_hour,normal_amount,overtime_amount,sunday_amount,sunday_callin_amount,public_holiday_amount,
    night_premium_amount,transport_allowance,gross_salary,paye_amount,ssc_amount,consensual_deductions,
    total_deductions,net_salary,compliance_warnings,calculation_segments,status)
  select v_tenant,(r->>'employee_id')::uuid,p_period,
    coalesce((r->>'normal_hours')::numeric,0),coalesce((r->>'overtime_hours')::numeric,0),
    coalesce((r->>'sunday_hours')::numeric,0),coalesce((r->>'sunday_callin_hours')::numeric,0),
    coalesce((r->>'public_holiday_hours')::numeric,0),coalesce((r->>'night_hours')::numeric,0),
    coalesce((r->>'annual_leave_hours')::numeric,0),coalesce((r->>'sick_leave_hours')::numeric,0),
    coalesce((r->>'compassionate_leave_hours')::numeric,0),coalesce((r->>'maternity_leave_hours')::numeric,0),
    coalesce((r->>'maternity_paid_hours')::numeric,0),coalesce((r->>'unpaid_leave_hours')::numeric,0),
    (r->>'rate_per_hour')::numeric,coalesce((r->>'normal_amount')::numeric,0),coalesce((r->>'overtime_amount')::numeric,0),
    coalesce((r->>'sunday_amount')::numeric,0),coalesce((r->>'sunday_callin_amount')::numeric,0),coalesce((r->>'public_holiday_amount')::numeric,0),
    coalesce((r->>'night_premium_amount')::numeric,0),coalesce((r->>'transport_allowance')::numeric,0),
    coalesce((r->>'gross_salary')::numeric,0),coalesce((r->>'paye_amount')::numeric,0),coalesce((r->>'ssc_amount')::numeric,0),
    coalesce((r->>'consensual_deductions')::numeric,0),coalesce((r->>'total_deductions')::numeric,0),coalesce((r->>'net_salary')::numeric,0),
    coalesce(r->'compliance_warnings','[]'::jsonb),coalesce(r->'calculation_segments','[]'::jsonb),'draft'
  from jsonb_array_elements(p_rows) r;
end $$;
