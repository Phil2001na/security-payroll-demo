# Security Audit Handoff — security-payroll-demo

Generated 2026-08-19 by a 7-lane parallel Claude audit (RLS/tenant isolation, RBAC/privilege
escalation, edge functions, financial/business-logic integrity, secrets exposure, frontend
authz/XSS, deployment config/dependencies). Handed off to Codex to implement.

## Context you need before touching anything

- Multi-tenant Supabase Postgres ERP (`nakvdkkezgdqxytygtqp`) for a Namibian security company:
  payroll, HR, disciplinary, AR/AP accounting, AI assistant (`erp-brain`, Gemini-backed).
- **Real tenant data is live** (UAT completed 2026-07-03) — this is not a demo anymore. Treat
  schema/RLS/trigger changes with production care.
- **The live Supabase schema has diverged from the migrations folder.**
  `supabase/schema-baseline-2026-07-05.sql` is a full DDL snapshot of live schema taken
  2026-07-05 — diff against that, not just `supabase/migrations/*.sql`, when reasoning about
  current state. New fixes should still be added as new dated migration files under
  `supabase/migrations/`.
- Stack: Vite + React 19 + TanStack Router/Query, TypeScript, bun, Supabase (Postgres + Edge
  Functions in `supabase/functions/`).
- Full project context: read `CLAUDE.md` and `UPDATES.md` at repo root first.
- **Do not apply migrations to the live Supabase project without explicit human sign-off**,
  especially for items 1–2 below (they change auth/RLS behavior on a system with real users).
  Prepare migrations, get them reviewed, then apply.
- Log every change to `UPDATES.md` per repo convention (newest entry at top).

---

## CRITICAL — fix first, both are unauthenticated/trivial exploits

### 1. Unauthenticated cross-tenant admin takeover via `handle_new_user()` trigger

**Files:** `supabase/migrations/20260628210000_admin_invited_users.sql` (lines 5-69), same
function body in `supabase/schema-baseline-2026-07-05.sql` (lines 819-882).

**Bug:** The trigger on `auth.users` INSERT reads
`NEW.raw_user_meta_data->>'invited_tenant_id'` and `'invited_role'` and inserts a `profiles` row
into that tenant with that role. It never checks that the insert actually came from the trusted
`admin-create-user` edge function. `raw_user_meta_data` is fully attacker-controlled via the
public Supabase Auth signup endpoint using only the anon key:

```js
supabase.auth.signUp({
  email, password,
  options: { data: { invited_tenant_id: '<any-known-tenant-uuid>', invited_role: 'admin' } }
})
```

This creates an **active admin profile in any tenant**, with zero prior access, no invite, no
session. Tenant UUIDs are visible across the app (URLs, API responses), so this is reachable by
anyone. It completely bypasses `admin-create-user`'s (correctly-implemented) caller-role check —
the real hole is one layer below it, in the trigger.

**Fix:** Never trust `invited_tenant_id`/`invited_role` from client-supplied
`raw_user_meta_data` directly. Introduce a `pending_invites` table: `admin-create-user` inserts a
row there (tenant_id, role, single-use token, expiry) when an admin invites someone; the client
signup flow passes only the invite token in metadata; `handle_new_user()` looks up the token,
validates it's unused/unexpired, consumes it, and only then creates the profile with the
tenant/role from the `pending_invites` row — never from client input.

### 2. Self-service privilege escalation via `onboarding_complete`

**Files:** `supabase/migrations/20260705101000_profiles_privilege_guard.sql` (function
`guard_profile_privileged_columns`, baseline lines 795-817); RLS policy `profiles_update_own`
(baseline line 1399); `src/components/role-onboarding-dialog.tsx` (lines 44-62).

**Bug:** The trigger blocks self-changes to `role`/`is_ceo_executive`/`is_active`/`tenant_id`
only when `old.onboarding_complete = true`. But `onboarding_complete` is an unguarded column any
user can PATCH via PostgREST at any time. Exploit (repeatable, not just first-login):

```
PATCH profiles?id=eq.<self> { onboarding_complete: false }
PATCH profiles?id=eq.<self> { role: 'admin' }   -- or tenant_id: '<other-tenant>'
```

Additionally, the onboarding dialog itself (`role-onboarding-dialog.tsx:44-62`) lets any newly
invited user simply click "Administrator" or "CEO/Executive" on first login — the guard trigger
doesn't stop this because `onboarding_complete` is still `false` at that point by design. A
migration comment literally says "first-run role picker itself still lets a new user choose
admin — acceptable for the demo, remove before a real client tenant" — this was never removed
and real tenant data has been live since 2026-07-03.

**Fix:**
- In the guard trigger, also block `onboarding_complete` from being set `false` once `true`
  (or restrict any change to `onboarding_complete` to a `SECURITY DEFINER` RPC only the server
  calls at actual onboarding completion time).
- Change `role-onboarding-dialog.tsx` so it only offers roles ≤ what the inviting admin assigned
  (or removes self-role-selection entirely — role should be set only by
  `admin-create-user`/`set_user_role`).

---

## HIGH

### 3. Payroll totals computed client-side, trusted verbatim server-side

**Files:** `src/lib/payroll-engine.ts` (`calculateNetPay`), `src/routes/_app.payroll.tsx`
(lines 374-409), RPC `replace_draft_payroll` in
`supabase/migrations/20260803181750_leave_management_module.sql` (lines 708-742). The only
server guard is `chk_payroll_net`
(`supabase/migrations/20260610120300_payroll_net_integrity_constraint.sql:4-7`), which just
checks `net = gross - deductions` — numbers the same caller supplies, so it constrains nothing.

**Impact:** Any `payroll`/`admin` role (or a forged direct RPC call bypassing the UI) can submit
arbitrary gross/net pay, inflated hours, or zeroed tax withholding, and it gets finalized and
posted to the general ledger as-is (`fn_post_payroll_to_ledger`,
`20260610120100_accounting_complete_coa_fix.sql:101-123`).

**Fix:** Recompute pay server-side (RPC or edge function) from `shift_logs`/rate tables/leave
balances; treat any client-submitted gross/net/PAYE figures as untrusted display-only data, not
input.

### 4. AI executive-memory tables regressed to tenant-wide readable

**Files:** baseline policies `supabase/schema-baseline-2026-07-05.sql` (lines 1287-1294) vs.
original scoped policies in
`supabase/migrations/20260524103000_phase1_ceo_erp_brain_foundation.sql` (lines 205-310).

**Bug:** Originally CEO/owner-scoped (`owner_user_id = auth.uid() AND is_ceo_executive()`,
`executive_user_id = auth.uid()`), the live schema now has plain
`tenant_id = get_my_tenant_id()` policies with no ownership check and no restrictive role
policies on `ai_conversation_sessions`, `ai_conversation_messages`, `ai_executive_memories`,
`ai_audit_events` — changed outside migration history (no migration file does this). A later
migration (`20260709202900_admin_ai_access.sql`) even comments "The AI tables remain owner-scoped
by their existing RLS policies," which is now false.

**Impact:** Any tenant member (including `viewer`) can read the CEO's private AI conversation
history and can INSERT `ai_executive_memories` rows with `executive_user_id` set to any other
user's id — planting false "executive memory" context the AI assistant will later treat as
trusted.

**Fix:** Restore owner-scoped restrictive RLS policies on all four tables via a new tracked
migration (don't just fix it live in the SQL editor again — that's how this regression happened
in the first place).

### 5. SSRF in `invoice-pdf` via tenant-controlled `logo_url`

**File:** `supabase/functions/invoice-pdf/index.ts` (lines 150-161).

```ts
if (t.logo_url) {
  const resp = await fetch(t.logo_url as string);
  ...
}
```

Unrestricted server-side fetch of a tenant-admin-editable URL, running with service-role
privileges in scope. Can be used for SSRF against internal/metadata endpoints.

**Fix:** Allowlist scheme (`https://` only) and validate host isn't a private/internal IP range
before fetching; ideally restrict to a known image-hosting domain allowlist.

### 6. Payroll/invoice data fetched to browser before role check

**Files:** `src/routes/_app.payroll.tsx` (role check at line 132, `AccessDenied` render doesn't
happen until line 501 — every `useQuery` above it runs unconditionally, including the
`payroll_runs` join with full `employees(*)` salary/rate data, keyed only on
`enabled: !!periodId`); `src/routes/_app.invoices.tsx` (same pattern, lines 776-813).

**Impact:** Any authenticated tenant user (e.g. `viewer`, `security_supervisor`) navigating to
`/payroll` or `/invoices` triggers the network fetch and the data lands in the browser/React
Query cache even though the UI then shows "Access restricted." Given findings #1/#2/#4 show RLS
and triggers have had real gaps, this frontend-only gate is not adequate defense-in-depth.
`src/routes/_app.accounting.tsx` already shows the correct pattern
(`enabled: canView` before the query fires, `AccessDenied` returned before any fetch) — just
apply that same pattern to `payroll.tsx` and `invoices.tsx`.

**Fix:** Add `enabled: hasPayrollAccess` / `enabled: canAdmin || canGenerate` to every `useQuery`
in both files, matching `accounting.tsx`.

---

## MEDIUM

7. **Overpayment race in invoice payments** — `sync_invoice_payment_status()`
   (`supabase/migrations/20260806013000_fix_invoice_payment_status_cast.sql:7-18`) reads
   `invoices.total` without `FOR UPDATE`; two concurrent `invoice_payments` inserts can both pass
   the "doesn't exceed total" guard. Fix: lock the invoice row (`SELECT ... FOR UPDATE`) before
   summing payments.

8. **Ledger never posts partial payments** —
   `fn_post_invoice_to_ledger` (`supabase/migrations/20260610120100_accounting_complete_coa_fix.sql:64-79`)
   only posts a ledger entry when `invoices.status` transitions to `'paid'`, but
   `sync_invoice_payment_status` only sets `'paid'` on exact full settlement
   (`20260806013000...sql:14`). Real partial payments recorded in `invoice_payments` never hit
   the ledger until final settlement, at which point the *entire* total posts as one lump entry
   dated at the final payment — books lag real cash receipts. Fix: post a ledger line per
   `invoice_payments` insert, not just on full settlement.

9. **`security_supervisor` can file disciplinary actions against any employee tenant-wide** —
   `supabase/migrations/20260719120000_supervisor_disciplinary_reporting.sql` (lines 10-22)
   checks `action_type`/`fine_amount`/`suspension_hours` but never that `employee_id` belongs to
   a site the supervisor is assigned to (`assigned_site_ids`). Fix: add that check to the
   restrictive INSERT policy.

10. **`employment_exits` approval chain can be skipped via direct UPDATE** —
    `supabase/migrations/20260719140000_employment_exits_and_disciplinary_verification.sql`
    (lines 76-81) has a comment claiming "no direct UPDATE" but the permissive + restrictive
    policies together do allow it; only column CHECK constraints (e.g.
    `verified_by <> recorded_by`) apply, nothing enforces the `recorded → verified → confirmed`
    sequence at the RLS/constraint level. Fix: either drop the direct UPDATE policy in favor of
    RPC-only transitions, or add a trigger enforcing the state machine.

11. **`replace_draft_payroll` missing row lock** —
    `finalize_payroll_period` takes `SELECT ... FOR UPDATE` on the pay period before checking
    status (`20260803181750_leave_management_module.sql:754-755`);
    `replace_draft_payroll` only does a plain `SELECT` (same file, lines 715-717). A race can
    leave orphaned draft payroll rows under an already-locked period. Fix: add the same
    `FOR UPDATE` lock to `replace_draft_payroll`.

12. **Wildcard CORS on all 4 edge functions** — `"Access-Control-Allow-Origin": "*"` in
    `admin-create-user`, `billing-engine`, `erp-brain`, `invoice-pdf`. No defense-in-depth if a
    bearer token ever leaks via another vector. Fix: pin to the app's actual origin(s).

13. **No HTTP security headers** on either deploy target (`vercel.json`, `wrangler.jsonc`) — no
    CSP, X-Frame-Options, HSTS, X-Content-Type-Options. Fix: add a headers config appropriate to
    whichever target is actually live (confirm which — see item 15).

14. **Two committed lockfiles out of sync** — `bun.lockb` (2026-06-05) and `package-lock.json`
    (2026-08-18, clearly regenerated by npm recently) are both tracked; `bunfig.toml` has
    `saveTextLockfile = false`. Dependency resolution isn't deterministic across
    contributors/CI. Fix: pick one package manager (repo scripts use bun), delete/gitignore the
    other lockfile.

15. **`billing-engine` can double-bill** — idempotency check ("skip if invoice already exists
    for this site+period") only runs `if (payPeriodId)`
    (`supabase/functions/billing-engine/index.ts:117-128`). Calling without `payPeriodId`, or
    retrying, creates duplicate invoices for the same shift-log rows. Fix: make the idempotency
    check unconditional, keyed on a deterministic value if `payPeriodId` is absent.

16. **`erp-brain` returns raw upstream Gemini error text to the client**
    (`supabase/functions/erp-brain/index.ts:852-870`) — the Gemini call embeds the API key in
    the request URL (`?key=${geminiApiKey}`, line 833); if an upstream error ever echoes request
    context, the key could leak client-side. Fix: log the raw error server-side only, return a
    generic message to the client.

17. **Deploy-target ambiguity still unresolved** — both `vercel.json` and `wrangler.jsonc` are
    present with no CI pinning one as canonical (CLAUDE.md already flags this as open). Resolve
    which is actually live; the non-live one's preview deployments may be publicly reachable and
    drifting from the hardened config.

---

## LOW

18. `dangerouslySetInnerHTML` in `src/components/ui/chart.tsx:73` — injects CSS custom
    properties from `ChartConfig`. Not reachable from user input today, but would become a
    CSS-injection vector if chart configs ever become tenant/user-controlled (e.g. custom
    branding colors). Add a comment/guard if that ever changes.
19. Most employee/entity detail-page queries in `src/routes/_app.employees.$employeeId.tsx`
    filter only by row `id`, not `tenant_id`, client-side (defense-in-depth gap; RLS is the real
    gate, but given items #1/#2/#4 above, an extra explicit tenant filter is cheap insurance).
20. `src/routes/auth.tsx` uses an unvalidated `redirect` search param in `navigate({ to:
    redirectTo })` (lines 26, 34) — likely not exploitable as open-redirect given TanStack
    Router's internal route resolution, but worth confirming.
21. `jspdf`/`jspdf-autotable` at v4.2.1/v5.0.7 and `xlsx` installed from a bare CDN tarball URL
    with no integrity hash pinned in `package.json` — run `bun audit` explicitly and consider
    pinning a checksum for the `xlsx` tarball.
22. No CI/CD pipeline at all — no automated `bun audit`/lint/test gate before deploy. Not a
    vulnerability itself, but it's why items like the lockfile drift and dependency versions
    above can silently ship.

---

## What's already solid (don't touch / no action needed)

- No hardcoded secrets anywhere in tracked files or git history; `.env*`/UAT-creds file properly
  gitignored; service_role key never bundled into client code.
- `get_my_tenant_id()`/`get_my_role()` correctly `SECURITY DEFINER` + `STABLE`, function grants
  locked down.
- Payroll lock/finalize RPCs, `set_user_role`, `set_user_sites` correctly re-derive
  tenant/role server-side.
- Leave-management module (`20260803181750_leave_management_module.sql`) is well-hardened:
  base tables SELECT-only, mutation via `SECURITY DEFINER` RPCs with `FOR UPDATE` locks and
  `pg_advisory_xact_lock`, separation-of-duties enforced (requester ≠ approver).
- No `USING (true)` policies found anywhere.
- AI-assistant markdown rendering (`_app.ai-assistant.tsx`) avoids raw HTML injection — safe
  against a prompt-injected Gemini response trying to emit `<script>`.
- Money columns are all `numeric(12,2)`/`numeric(14,2)` — no float rounding risk.
- Auth/role state always re-fetched fresh from Supabase (`auth-context.tsx`), never trusted from
  localStorage.

---

## Suggested execution order for Codex

1. Items 1–2 (critical) — write migrations, **do not apply to live DB without human review**.
2. Item 4 (AI table RLS regression) — same caution, it's also an RLS/policy change.
3. Item 6 (frontend query gating) — pure code change, low risk, safe to apply directly.
4. Item 3 (server-side payroll recomputation) — larger change, needs design discussion on how
   much of `payroll-engine.ts` logic to port server-side vs. call from an RPC.
5. Item 5 (SSRF fix) — straightforward, low risk.
6. Remaining medium items (7–17) — independent, can be done in any order/parallel.
7. Low items (18–22) — cleanup, lowest priority.

Log each completed fix in `UPDATES.md` per repo convention.
