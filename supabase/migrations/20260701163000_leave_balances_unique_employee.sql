-- finalize_payroll_period upserts leave_balances with `on conflict (employee_id) do update`,
-- but leave_balances only had a primary key on id — no unique constraint matching that target,
-- so every "lock payroll" attempt failed with "no unique or exclusion constraint matching the
-- ON CONFLICT specification". No duplicate employee_id rows existed, so this is a safe additive fix.
alter table public.leave_balances
  add constraint leave_balances_employee_id_key unique (employee_id);
