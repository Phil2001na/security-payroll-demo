# security-payroll-demo — AI / developer guide

Namibian security-company payroll + accounting app (multi-tenant). Started as a pitch demo;
now has real hardening work (RLS, RBAC) and is the **active** repo for this product line — see
`dog-force-payroll` (sibling repo) for the earlier, now-superseded build.

## Stack

- Lovable-scaffolded **Vite + React 19 + TanStack Router/Query**, TypeScript, bun
  (`bun.lockb`/`bunfig.toml`), shadcn/radix components (`components.json`), Tailwind.
- **Supabase** Postgres project `nakvdkkezgdqxytygtqp` — multi-tenant via `get_my_tenant_id()` /
  `get_my_role()` helpers, RLS on every table.
- Deploy targets present: `vercel.json` (Vercel) and `wrangler.jsonc` (Cloudflare) — check which
  is currently live before assuming; `dist/` is a Vite build output, not a framework-managed dir.

## Commands

```bash
bun install
bun run dev
bun run build
bun run lint
bun run format
bun run test          # bun's runner; specs in tests/ (payroll segmentation, Sunday rules)
```

## Data model & security — read before touching RLS/roles

- **The live Supabase schema has diverged from repo migrations.** `supabase/schema-baseline-2026-07-05.sql`
  is the missing "migration zero" — a full DDL snapshot of live schema taken 2026-07-05. Diff
  against that, not just the migrations folder, when reasoning about current schema state.
- Roles: `admin`, `payroll`, `security_supervisor`, `viewer`/`ceo` etc. — restrictive per-command
  RLS policies require the *right* role, not just tenant membership (fixed 2026-07-05; previously
  any tenant member could write payroll/HR/accounting tables via PostgREST).
- `profiles_update_own` is guarded by a trigger blocking self-changes to
  `role`/`is_ceo_executive`/`is_active`/`tenant_id` after onboarding — don't "fix" a permission
  issue by relaxing this; it closes a privilege-escalation hole.
- Payroll lock/finalize RPCs (`replace_draft_payroll`, `finalize_payroll_period`) accept `admin`
  as a fallback alongside `payroll`. `finalize_payroll_period` also refuses to lock a period
  whose manually entered Sunday base rate differs from the calculated ordinary rate and has not
  been acknowledged — see `SUNDAY_CALCULATION.md`.
- Sunday pay: the reduced 1.5× applies only where the standing contract consent is verifiable;
  otherwise the statutory 2× applies. A shift crossing midnight stays ONE roster/attendance
  record and is split into segments for calculation only — never into two shifts.
- `erp-brain` is a Supabase Edge Function (Gemini-backed AI assistant: PDF/Excel/chart
  generation). Its `GEMINI_API_KEY`/`GEMINI_MODEL` are Supabase secrets, not repo env vars.
- Before shipping any RLS/policy/grant change: check Supabase security advisors
  (`get_advisors`) and smoke-test with impersonated JWTs per role — this is how the 2026-07-05
  hardening pass caught the self-escalation and silent-failure bugs.

## Modules

- Core payroll + leave calculation (`LEAVE_CALCULATION.md`), AR/AP invoicing, accounting, and
  an AI assistant layer (`AI_ASSISTANT_PHASE1_SCHEMA.md`).

## Conventions

- Log every meaningful change to `UPDATES.md` — newest entry at top.
- Payroll rules that carry a legal interpretation are configuration, not constants, and the
  reasoning lives in a dated design doc (`SUNDAY_CALCULATION.md`, `LEAVE_CALCULATION.md`).
- This has real tenant data (UAT completed 2026-07-03) — treat schema/RLS changes with the same
  care as a live production system, not a demo.
