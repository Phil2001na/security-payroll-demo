-- Enforce payroll net integrity: net must equal gross minus total deductions.
-- NOT VALID so existing rows are not retro-checked; the gross-to-net engine
-- already guarantees this invariant on every new/updated row.
ALTER TABLE public.payroll_runs DROP CONSTRAINT IF EXISTS chk_payroll_net;
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT chk_payroll_net
  CHECK (net_salary = gross_salary - total_deductions) NOT VALID;
