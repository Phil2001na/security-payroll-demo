-- Leave accrual by working-days-per-week (item 7) + date/clock-aware payroll (item 3).
--
-- 1. shift_types gains a clock window (start_min/end_min, minutes from midnight) so the
--    payroll engine can split a shift's hours across the midnight / Sunday / public-holiday
--    boundary and isolate the night band (20h00–07h00, Labour Act s.19).
-- 2. tenants.night_premium_enabled — CEO toggle to suppress the +6% night premium.
-- 3. employees.days_per_week — drives the monthly leave accrual rate.
-- 4. leave_accruals ledger — one row per (employee, pay period); guarantees accrual is
--    idempotent across re-finalizes.
-- 5. finalize_payroll_period also accrues a month of leave when a period is finalized.

-- ── 1. Shift clock windows ───────────────────────────────────────────────────
ALTER TABLE public.shift_types
  ADD COLUMN IF NOT EXISTS start_min smallint,
  ADD COLUMN IF NOT EXISTS end_min smallint;

-- Seed existing shift types: night shifts start 19:00 (1140), everything else 07:00 (420);
-- the end is the start plus the shift's default length, wrapping past midnight.
UPDATE public.shift_types
   SET start_min = CASE WHEN period = 'night' THEN 1140 ELSE 420 END,
       end_min   = ((CASE WHEN period = 'night' THEN 1140 ELSE 420 END) + (default_hours * 60)::int) % 1440
 WHERE start_min IS NULL;

-- ── 2. Night premium toggle (CEO setting) ────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS night_premium_enabled boolean NOT NULL DEFAULT true;

-- ── 3. Working days per week (drives accrual) ────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS days_per_week numeric(3,1) NOT NULL DEFAULT 6;

-- ── 4. Leave accrual ledger ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_accruals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  pay_period_id uuid NOT NULL REFERENCES public.pay_periods(id) ON DELETE CASCADE,
  days_accrued  numeric(6,4) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, pay_period_id)
);
CREATE INDEX IF NOT EXISTS idx_leave_accruals_tenant ON public.leave_accruals(tenant_id);

ALTER TABLE public.leave_accruals ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped, mirroring the live leave_balances / payroll_runs policies. Writes
-- happen through the SECURITY DEFINER finalize RPC; these allow the app to read the
-- ledger (and admins to correct it).
DROP POLICY IF EXISTS leave_accruals_select ON public.leave_accruals;
DROP POLICY IF EXISTS leave_accruals_insert ON public.leave_accruals;
DROP POLICY IF EXISTS leave_accruals_update ON public.leave_accruals;
CREATE POLICY leave_accruals_select ON public.leave_accruals
  FOR SELECT USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY leave_accruals_insert ON public.leave_accruals
  FOR INSERT WITH CHECK (tenant_id = public.get_my_tenant_id());
CREATE POLICY leave_accruals_update ON public.leave_accruals
  FOR UPDATE USING (tenant_id = public.get_my_tenant_id());

-- ── 5. Accrue leave on payroll finalize ──────────────────────────────────────
-- Entitlement per the 2026 sectoral determination / Labour Act s.23: annual days =
-- days_per_week × 4, accrued one twelfth each finalized monthly period. The ledger's
-- unique (employee_id, pay_period_id) makes re-finalizing a period a no-op for leave.
CREATE OR REPLACE FUNCTION public.finalize_payroll_period(p_period uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_role text;
begin
  v_tenant := public.get_my_tenant_id();
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_tenant is null or v_role <> 'payroll' then
    raise exception 'Not authorized to finalize payroll';
  end if;

  update public.payroll_runs
     set status = 'finalized', finalized_at = now()
   where pay_period_id = p_period and status = 'draft' and tenant_id = v_tenant;

  update public.pay_periods
     set status = 'locked', locked_at = now(), locked_by = auth.uid()
   where id = p_period and tenant_id = v_tenant;

  -- Accrue a month of leave for active officers (skip management / monthly-salary staff).
  -- Only rows newly inserted into the ledger bump the balance, so this is idempotent.
  with ins as (
    insert into public.leave_accruals (tenant_id, employee_id, pay_period_id, days_accrued)
    select v_tenant, e.id, p_period, round((e.days_per_week * 4.0 / 12.0)::numeric, 4)
      from public.employees e
     where e.tenant_id = v_tenant
       and e.status = 'active'
       and e.category = 'officer'
    on conflict (employee_id, pay_period_id) do nothing
    returning employee_id, days_accrued
  )
  insert into public.leave_balances (tenant_id, employee_id, annual_days)
  select v_tenant, ins.employee_id, ins.days_accrued from ins
  on conflict (employee_id) do update
     set annual_days = public.leave_balances.annual_days + excluded.annual_days,
         updated_at = now();
end; $function$;
