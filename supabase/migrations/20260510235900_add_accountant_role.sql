-- Must run in a separate transaction from any SQL that uses the new enum value.
-- PostgreSQL does not allow using a newly-added enum value in the same transaction.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accountant';
