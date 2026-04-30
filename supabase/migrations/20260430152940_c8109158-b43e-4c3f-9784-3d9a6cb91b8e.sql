-- Add driver position
ALTER TYPE public.employee_position ADD VALUE IF NOT EXISTS 'driver';

-- Add monthly_salary column for fixed-salary management
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS monthly_salary numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.employees.monthly_salary IS 'Fixed monthly salary in NAD for management category. Officers (guards/drivers) are paid hourly_rate * hours.';