-- Payroll rows are calculated from authoritative source records by the
-- run-payroll Edge Function. Browser clients must not be able to call this
-- persistence RPC with a forged JSON payroll payload.
revoke all on function public.replace_draft_payroll(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_draft_payroll(uuid, jsonb) to service_role;
