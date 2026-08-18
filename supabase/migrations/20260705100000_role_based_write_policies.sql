-- Role-based write authorization (DB-level RBAC)
--
-- Until now, RLS on core tables was tenant-scoped only (tenant_id = get_my_tenant_id()),
-- meaning ANY authenticated member of a tenant (including viewer / CEO-executive /
-- security_supervisor) could write directly to payroll, HR and accounting tables via
-- PostgREST, bypassing the client-side role guards.
--
-- This migration adds RESTRICTIVE policies per write command (INSERT/UPDATE/DELETE).
-- Restrictive policies are ANDed with the existing permissive tenant policies, so:
--   allowed = same-tenant  AND  caller role is in the table's writer set.
-- SELECT is untouched (all tenant members can still read).
--
-- Writer sets (mirrors the app's route access):
--   attendance: admin, operations, supervisor, payroll, security_supervisor
--   hr:         admin, operations, supervisor, payroll
--   payroll:    admin, operations, payroll
--   accounting: admin, accountant (clients also + operations)
--   org config: admin, operations (sites); admin only (tenants, payroll_constants)

-- Helper: current user's role (SECURITY DEFINER so it works despite profiles RLS).
create or replace function public.get_my_role()
returns text
language sql stable security definer
set search_path to 'public'
as $$
  select role::text from profiles where id = auth.uid() and is_active;
$$;

revoke all on function public.get_my_role() from anon;
grant execute on function public.get_my_role() to authenticated;

do $do$
declare
  cfg record;
  cmd record;
begin
  for cfg in
    select * from (values
      -- attendance / scheduling
      ('shift_logs',           array['admin','operations','supervisor','payroll','security_supervisor']),
      ('schedule_assignments', array['admin','operations','supervisor','payroll','security_supervisor']),
      ('deductions',           array['admin','operations','supervisor','payroll','security_supervisor']),
      ('attendance_logs',      array['admin','operations','supervisor','payroll','security_supervisor']),
      -- HR
      ('employees',            array['admin','operations','supervisor','payroll']),
      ('disciplinary_actions', array['admin','operations','supervisor','payroll']),
      ('leave_balances',       array['admin','operations','supervisor','payroll']),
      ('leave_accruals',       array['admin','operations','supervisor','payroll']),
      ('signed_agreements',    array['admin','operations','supervisor','payroll']),
      ('shift_types',          array['admin','operations','supervisor','payroll']),
      -- payroll
      ('pay_periods',          array['admin','operations','payroll']),
      ('payroll_runs',         array['admin','operations','payroll']),
      ('ps_exemptions',        array['admin','operations','payroll']),
      ('deduction_types',      array['admin','operations','payroll']),
      -- accounting
      ('invoices',             array['admin','accountant']),
      ('invoice_items',        array['admin','accountant']),
      ('vendors',              array['admin','accountant']),
      ('ledger_entries',       array['admin','accountant']),
      ('ledger_lines',         array['admin','accountant']),
      ('chart_of_accounts',    array['admin','accountant']),
      ('service_items',        array['admin','accountant']),
      ('installment_plans',    array['admin','accountant']),
      ('clients',              array['admin','operations','accountant']),
      -- org config
      ('sites',                array['admin','operations']),
      ('site_requirements',    array['admin','operations']),
      ('tenants',              array['admin']),
      ('payroll_constants',    array['admin'])
    ) as v(tbl, allowed)
  loop
    for cmd in select * from (values ('insert'), ('update'), ('delete')) as c(op) loop
      execute format('drop policy if exists %I on public.%I',
                     cfg.tbl || '_role_' || cmd.op, cfg.tbl);
      if cmd.op = 'insert' then
        execute format(
          'create policy %I on public.%I as restrictive for insert to authenticated with check (public.get_my_role() = any (%L::text[]))',
          cfg.tbl || '_role_insert', cfg.tbl, cfg.allowed);
      else
        execute format(
          'create policy %I on public.%I as restrictive for %s to authenticated using (public.get_my_role() = any (%L::text[]))',
          cfg.tbl || '_role_' || cmd.op, cfg.tbl, cmd.op, cfg.allowed);
      end if;
    end loop;
  end loop;
end;
$do$;

-- Bug fix: payroll_constants had a SELECT policy only, so the admin-settings save
-- (direct UPDATE from _app.admin.settings.tsx) matched zero rows and silently did
-- nothing. Add the missing permissive tenant-scoped UPDATE policy; the restrictive
-- policy above limits it to admins.
drop policy if exists payroll_constants_update on public.payroll_constants;
create policy payroll_constants_update on public.payroll_constants
  for update using (tenant_id = get_my_tenant_id());
