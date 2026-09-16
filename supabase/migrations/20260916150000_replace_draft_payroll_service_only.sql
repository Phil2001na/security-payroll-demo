-- replace_draft_payroll is called by the run-payroll edge function with the service-role
-- client, but it authorized the caller through get_my_tenant_id()/auth.uid(), which are NULL
-- for the service role. Every server-side payroll run since run-payroll was first deployed
-- (2026-09-02) therefore failed with "Not authorized to run payroll" and saved nothing.
--
-- run-payroll already authenticates the user, checks the role (payroll/admin) and the open
-- period, and resolves the tenant from the user's profile. The function now takes that tenant
-- explicitly and is executable by the service role only - which is also what
-- 20260818232852_restrict_payroll_write_to_server intended, but live still granted it to
-- authenticated, letting a signed-in payroll/admin user write arbitrary draft figures
-- directly over PostgREST.
--
-- Applied over the pooler on 2026-09-16 (migration history is unreconciled; do not db push).

drop function if exists public.replace_draft_payroll(uuid, jsonb);

create function public.replace_draft_payroll(p_period uuid, p_rows jsonb, p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Payroll drafts can only be saved by the run-payroll service';
  end if;
  if p_tenant is null then raise exception 'Tenant is required'; end if;

  perform 1 from public.pay_periods where id = p_period and tenant_id = p_tenant and status = 'open' for update;
  if not found then raise exception 'Open payroll period not found'; end if;

  delete from public.payroll_runs where pay_period_id = p_period and status = 'draft' and tenant_id = p_tenant;
  insert into public.payroll_runs (
    tenant_id,employee_id,pay_period_id,normal_hours,overtime_hours,sunday_hours,sunday_callin_hours,
    public_holiday_hours,night_hours,annual_leave_hours,sick_leave_hours,compassionate_leave_hours,maternity_leave_hours,maternity_paid_hours,unpaid_leave_hours,
    rate_per_hour,normal_amount,overtime_amount,sunday_amount,sunday_callin_amount,public_holiday_amount,
    night_premium_amount,transport_allowance,gross_salary,paye_amount,ssc_amount,consensual_deductions,
    total_deductions,net_salary,compliance_warnings,calculation_segments,status)
  select p_tenant, e.id, p_period,
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
  from jsonb_array_elements(p_rows) r
  -- An employee id that is not in this tenant is dropped rather than written cross-tenant.
  join public.employees e on e.id = (r->>'employee_id')::uuid and e.tenant_id = p_tenant;
end $$;

revoke all on function public.replace_draft_payroll(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.replace_draft_payroll(uuid, jsonb, uuid) to service_role;
