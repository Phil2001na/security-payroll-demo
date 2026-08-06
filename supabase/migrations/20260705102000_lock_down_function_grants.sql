-- Lock down function EXECUTE grants (from security advisor findings).
-- Trigger/internal functions should not be callable via PostgREST RPC at all;
-- user-facing RPCs should be callable by authenticated users only (they carry
-- their own role checks internally), never by anon.

-- Pin search_path on the one function missing it
alter function public.touch_updated_at() set search_path = 'public';

-- Trigger-only / internal functions: no API access for anyone
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.fn_recalc_invoice_total() from public, anon, authenticated;
revoke all on function public.fn_assign_invoice_number() from public, anon, authenticated;
revoke all on function public.fn_post_invoice_to_ledger() from public, anon, authenticated;
revoke all on function public.fn_check_ledger_balance() from public, anon, authenticated;
revoke all on function public.fn_post_payroll_to_ledger() from public, anon, authenticated;
revoke all on function public.fn_get_or_create_account(uuid, text, text, account_type, normal_balance_type) from public, anon, authenticated;
revoke all on function public.guard_profile_privileged_columns() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- User-facing RPCs and RLS helpers: authenticated only, never anon
revoke all on function public.finalize_payroll_period(uuid) from public, anon;
grant execute on function public.finalize_payroll_period(uuid) to authenticated;
revoke all on function public.replace_draft_payroll(uuid, jsonb) from public, anon;
grant execute on function public.replace_draft_payroll(uuid, jsonb) to authenticated;
revoke all on function public.set_user_role(uuid, app_role) from public, anon;
grant execute on function public.set_user_role(uuid, app_role) to authenticated;
revoke all on function public.set_user_sites(uuid, uuid[]) from public, anon;
grant execute on function public.set_user_sites(uuid, uuid[]) to authenticated;
revoke all on function public.set_site_supervisors(uuid, uuid[]) from public, anon;
grant execute on function public.set_site_supervisors(uuid, uuid[]) to authenticated;
revoke all on function public.get_my_tenant_id() from public, anon;
grant execute on function public.get_my_tenant_id() to authenticated;
revoke all on function public.get_my_role() from public, anon;
grant execute on function public.get_my_role() to authenticated;
