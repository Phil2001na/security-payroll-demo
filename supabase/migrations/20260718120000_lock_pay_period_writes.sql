-- Defense-in-depth for pay-period locking.
--
-- Today, "locked" is enforced only by application convention:
--   - finalize_payroll_period() only flips draft rows and only runs once per period
--   - the UI disables the Run/Finalize buttons once pay_periods.status <> 'open'
-- But the tenant-scoped + role-scoped RLS on payroll_runs/pay_periods (see
-- 20260705100000_role_based_write_policies.sql) never checks period status, so any
-- payroll/admin user could still UPDATE/DELETE payroll_runs, or re-open a pay_periods
-- row, directly via PostgREST after finalize, bypassing the RPC entirely.
--
-- These restrictive policies close that gap. They're ANDed with the existing
-- permissive + role policies, so:
--   allowed = same-tenant AND correct role AND period not locked
--
-- finalize_payroll_period()/replace_draft_payroll() are SECURITY DEFINER, owned by
-- postgres, which bypasses RLS entirely -- so this does not affect those RPCs. It only
-- blocks direct table writes from authenticated clients.

-- payroll_runs: no insert/update/delete once the parent period is locked/paid.
drop policy if exists payroll_runs_period_open_insert on public.payroll_runs;
create policy payroll_runs_period_open_insert on public.payroll_runs
  as restrictive for insert to authenticated with check (
    exists (
      select 1 from public.pay_periods pp
       where pp.id = payroll_runs.pay_period_id
         and pp.status = 'open'
    )
  );

drop policy if exists payroll_runs_period_open_update on public.payroll_runs;
create policy payroll_runs_period_open_update on public.payroll_runs
  as restrictive for update to authenticated using (
    exists (
      select 1 from public.pay_periods pp
       where pp.id = payroll_runs.pay_period_id
         and pp.status = 'open'
    )
  ) with check (
    exists (
      select 1 from public.pay_periods pp
       where pp.id = payroll_runs.pay_period_id
         and pp.status = 'open'
    )
  );

drop policy if exists payroll_runs_period_open_delete on public.payroll_runs;
create policy payroll_runs_period_open_delete on public.payroll_runs
  as restrictive for delete to authenticated using (
    exists (
      select 1 from public.pay_periods pp
       where pp.id = payroll_runs.pay_period_id
         and pp.status = 'open'
    )
  );

-- pay_periods: once a row is locked/paid, no direct client UPDATE (including trying
-- to move it back to 'open'). Only the SECURITY DEFINER RPC (which bypasses RLS) can
-- transition status going forward.
drop policy if exists pay_periods_not_locked_update on public.pay_periods;
create policy pay_periods_not_locked_update on public.pay_periods
  as restrictive for update to authenticated using (
    status = 'open'
  );
