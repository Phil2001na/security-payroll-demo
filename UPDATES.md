# Updates

## 2026-07-02

### 00:21
- Set Supabase `GEMINI_API_KEY`/`GEMINI_MODEL` secrets from the local Jarvis env and deployed the updated `erp-brain` edge function to project `nakvdkkezgdqxytygtqp`.

### 00:19
- Hardened `/supervisors` against null `assigned_site_ids` values so supervisor-site assignment rendering does not crash when Supabase returns an empty/null array after payroll workflows.
- Switched the `erp-brain` chatbot edge function from Anthropic to Gemini (`GEMINI_API_KEY`, default `gemini-2.5-flash`) while preserving existing PDF/Excel/chart tool-call handling and audit metadata.

## 2026-07-01

### 16:35
- **Fixed "no unique or exclusion constraint matching the ON CONFLICT specification" on Finalize/Lock payroll.** `finalize_payroll_period` upserts `leave_balances` via `on conflict (employee_id) do update`, but `leave_balances` only ever had a primary key on `id` — no unique constraint on `employee_id` for Postgres to match against, so locking a period always failed at the leave-crediting step (after the period/run were already marked locked/finalized). Verified no duplicate `employee_id` rows existed, then added `UNIQUE (employee_id)` on `leave_balances` (live `nakvdkkezgdqxytygtqp` + migration `20260701163000_leave_balances_unique_employee.sql`).

### 16:20
- **Payroll role now has access to the Disciplinary module.** Added `payroll` to the sidebar nav gate (`app-shell.tsx`) and the page's role guard (`_app.disciplinary.tsx`) — previously only admin/operations/supervisor could see it. No DB change needed: live RLS on `disciplinary_actions` is tenant-scoped only (`tenant_id = get_my_tenant_id()`), no role check at the database layer.

### 16:05
- **Approvals is now a single-date view, matching the Daily Muster's date navigator.** Previously it fetched every `submitted` log across all dates and stacked them into one long page (a card per date with its own "Approve day" button). Now it has the same prev/next/date-picker/Today controls as Attendance, queries only the selected date, and "Approve all" applies to that date. Keeps the existing per-site grouping and per-row Approve/Absent actions underneath.

### 15:40
- **Shift preference is now a soft signal, not a hard block, in both scheduling paths (auto-fill/generate roster and the manual "Custom request" fill).** Previously `preferred_shift` (`day`/`night`/`both`) hard-excluded a guard from the opposite shift kind — e.g. a `day`-only guard could never be picked for a night slot even if that left the site short. Verified this was in fact the cause of the lopsided day/night splits seen in the schedule: every guard with a 100%-one-kind history had that exact preference set. Now each fill first tries preference-matching guards, and only reaches into off-preference guards to cover a genuine shortage — so a short-staffed slot gets filled instead of left empty, but preference still wins whenever there's no shortage. Toasts now report how many shifts were assigned "against shift preference" when this kicks in.
- **Reset all 144 employees' `preferred_shift` back to the default `both`** (was 21 `day` / 15 `night` / 108 `both`) — those day/night values were set before the hard-filter logic existed and no longer reflect an intentional constraint; `both` lets the scheduler pick freely per the corrected logic above.
- **Replacement/relief in Daily Muster now shows who covered whom, and no longer auto-marks the reliever present.** Previously "Find replacement" marked the absent guard `no_show` (indistinguishable from a plain absence) and inserted the relief guard's shift log as `approved` — bypassing the supervisor's own present/absent call. Now: the original guard's log is set to the (already-defined but previously unused) `replaced_by_other` status, both rows show a cross-reference ("Replaced by X" / "Relief for Y"), and the reliever's shift log is inserted as `pending` — they show up as a normal muster row that still needs to be marked present/absent like anyone else. The "Replaced" KPI card, which was always 0 before because nothing ever wrote `replaced_by_other`, now reflects reality. Also disabled "Find replacement" once a slot is already replaced, to prevent double relief.
- **Removed the duplicate "Assign sites" picker from System Users.** Site assignment for supervisors is now done in one place only: the site card on the **Sites** page (`SiteSupervisorsPopover`, added 2026-06-29). System Users no longer shows a per-user sites column/popover or fires `set_user_sites` directly; its copy now links to Sites instead.
- **Site card action buttons laid out as a 2×2 grid.** Edit site / Assign supervisors / Manpower / Contract terms are now equal-width and evenly spaced instead of a stacked column with one oddly narrow button (Manpower's default trigger had no `w-full`).

## 2026-06-29

### 10:30
- **Supervisor → attendance → payroll-verify flow tidied up.** The whole flow already existed on the attendance-only `security_supervisor` role (site-scoped Daily Muster → marks save as `submitted` → payroll approves/flags on **Approvals**); the gaps were assignment UX and naming.
  - **Assign supervisors from the site screen.** Each site card now has an "Assign supervisors" picker (payroll/ops/admin) listing all supervisors; saving updates their `assigned_site_ids`. New SECURITY DEFINER RPC `set_site_supervisors(p_site, p_user_ids)` — inverse of `set_user_sites`, adds/removes the site across the chosen supervisors. Migration `20260629100000_set_site_supervisors.sql` (live `nakvdkkezgdqxytygtqp`). New `site-supervisors-popover.tsx`. `/supervisors` page kept as the per-person view.
  - **One supervisor role, relabelled.** `security_supervisor` is now labelled simply **"Supervisor"** in all role pickers (Add User + System Users); removed the old broad `supervisor` option from the pickers (enum value retained, code paths dormant). Updated copy on Supervisors + Approvals pages ("verify" wording).
  - Note: the "no attendance when logged in as supervisor" report was because the test account (thomas partay) is a **viewer** and there were zero supervisor accounts. Set a user's role to Supervisor under System Users, then assign sites (on the site card or /supervisors).

### 21:15
- **Admin-created users instead of self-signup.** Previously every signup fired the `handle_new_user` trigger, which provisioned a *new tenant* + admin profile — so a new account looked like "signing up your own company". Now an admin adds users directly into their own organisation.
  - DB (live `nakvdkkezgdqxytygtqp`): `handle_new_user` now checks `invited_tenant_id` in auth metadata — when present, it attaches the new profile to that tenant with the chosen `invited_role` and skips tenant/catalog creation. Self-signup path unchanged as a fallback. Migration `20260628210000_admin_invited_users.sql`.
  - New edge function **`admin-create-user`** (service-role): verifies the caller is an active admin, creates the auth user with `email_confirm: true` (no email verification), and passes `invited_tenant_id`/`invited_role`/`full_name` metadata so the trigger routes the profile into the caller's tenant.
  - System Users page: added an **Add user** dialog (first name, surname, email, role, temp password) that calls the edge function; the user can sign in immediately. Removed the public **Sign up** tab from `auth.tsx` — login is sign-in only now ("Ask your administrator to create one").

### 20:05
- **Admin Settings visibility fix.** The sidebar's Administration section (Admin Settings, System Users) was gated `role === "admin" && !is_ceo_executive`, so CEO-executive accounts never saw it. Per request: (1) flipped Philip's profile `is_ceo_executive → false` so his account is a full admin again; (2) CEO accounts now also see **Admin Settings** in the nav (`app-shell.tsx` — System Users stays admin-only); (3) relaxed the settings page guard to allow CEO through (`role === "admin" || is_ceo_executive`).

### 12:00
- **Leave now accrues from actual days worked, not a fixed `days_per_week`.** The old model credited every active officer `days_per_week × 4 ÷ 12` each finalized period regardless of attendance — a guess made at onboarding, and unfair (officers who worked very differently accrued identical leave). Rewrote `finalize_payroll_period` to credit `approved work days in the period ÷ 12` (Labour Act s.23 re-expressed as 1 leave day per 12 worked days — schedule-independent: ~288 days/yr → ~24, ~240 → ~20). A worked day = a distinct date with an **approved** shift log whose pay rule isn't `off`/leave; doubles count as one day. Idempotent via `leave_accruals` unique(employee, period). Migration `20260628120000_leave_accrual_from_worked_days.sql` (live `nakvdkkezgdqxytygtqp`).
- `days_per_week` is now a **scheduling guide only** (no leave effect). Onboarding + employee detail relabelled "Typical days / week", dropped the "→ N leave days/yr" promise; Leave card now shows "1 day / 12 worked" and an accurate caption.
- Added root `LEAVE_CALCULATION.md` documenting the rule, the 1-in-12 derivation, what counts as a worked day, and where it lives in the code.

## 2026-06-25
- Added `verification-checklist.html` (root) — a standalone UAT checklist derived from this file: each update with its expected "green light" outcome and per-item **Pass / Fail** buttons. Failures open a notes box to record the actual behavior. State persists in the browser (localStorage); an **Export** button writes `uat-results.md` (failures + notes) for review. No database.
- **Sunday & Public Holiday pay multipliers are now editable** in Admin → Settings → Payroll constants. Seeded `sunday_default_multiplier` and `public_holiday_multiplier` rows (default **2×**, Labour Act s.21(5)) for every tenant — previously these rows didn't exist and the engine silently used a hardcoded 2× fallback, so there was nothing to edit. The engine already reads both keys; migration `20260625120000_seed_sunday_ph_multipliers.sql` (live).
- **Reduced Sunday rate for "ordinarily works Sundays" employees.** Engine now applies a separate, editable `sunday_agreed_multiplier` (default **1.5×**, Labour Act s.21) to officers with `ordinarily_works_sundays = true`; everyone else keeps the 2× default. Seeded for all tenants (`20260625130000_seed_sunday_agreed_multiplier.sql`, live). On the live tenant this affects 5 officers. Payslip PDF (`payslip-pdf.ts`) earnings rows now **derive** the Overtime/Sunday/PH multiplier and night-premium % from the computed amounts instead of hardcoding 1.5×/2×/6%, so labels stay correct under any configured rate (also fixes the night row that hardcoded 6% while the tenant runs 10%).
- **Scheduler cost ranking honours the agreement rate.** `estimateShiftCost` now takes an `ordinarilyWorksSundays` flag and costs those guards' Sunday shifts at 1.5×; the schedule's employee query + `Employee` type + `SCHED_CONSTANTS` carry the flag/rate. Keeps the cheapest-guard auto-assignment consistent with actual pay.

## 2026-06-24
- **Payroll engine is now date- & clock-aware (item 3).** Rewrote `bucketiseLogs` in `payroll-engine.ts` to split every paid hour by the real calendar day it falls on, using new shift-type clock windows (`shift_types.start_min/end_min`, seeded Day 07:00–19:00 / Night 19:00–07:00). A night shift crossing into a Sunday/public holiday now earns the 2× premium only for the hours that actually land there, and the +6% night premium is isolated to the 20h00–07h00 band. Fixes the prior gap where auto-generated Sunday shifts (standard shift type) were not paid the Sunday rate. Payroll page passes `public_holidays` + the tenant toggle into the engine.
- **Night-premium CEO toggle.** New `tenants.night_premium_enabled` (default true) + a switch in Admin → Settings ("Pay night-shift premium"). When off, night hours still show on payslips but the +6% is not paid (for operators not chasing full compliance).
- **Monthly leave accrual by working-days-per-week (item 7).** New `employees.days_per_week` (default 6) + `leave_accruals` ledger. `finalize_payroll_period` now accrues `days_per_week × 4 ÷ 12` per active officer each finalized period (6 days/wk → +2.0/mo), idempotent via `unique(employee_id, pay_period_id)`. Employee form/detail pages expose days/week and show the leave balance + monthly accrual rate.
- DB (live `nakvdkkezgdqxytygtqp`): migration `20260624120000_leave_accrual_and_shift_windows.sql` (additive — new columns/table/RPC, all backfilled). Types hand-updated in `integrations/supabase/types.ts`. Note: the date-driven engine pays Sunday hours that were previously missed, so some payslip totals will increase (intended/more correct).
- Enabled the **payroll** role to run employee onboarding — the contract sign/upload page (`/onboarding/$employeeId`) now lets payroll manage contracts alongside admin/operations/supervisor (UAT: "payroll does employee onboarding").

## 2026-06-22
- Added new **`security_supervisor`** role — attendance-only. Sidebar/routes locked to the Attendance module; dashboard redirects them to `/attendance`.
- Security supervisors are site-scoped to `assigned_site_ids`, **cannot replace guards**, and their "present" marks save as new `shift_log_status` `submitted` (badge "Awaiting approval") instead of `approved`.
- New `/approvals` page (admin/operations/payroll): payroll approves submitted attendance (→`approved`) or rejects as absent before it counts toward pay; payroll engine now pays **only `approved`** logs.
- New `/supervisors` page (admin/operations/payroll): payroll assigns sites to security supervisors. Shared `site-assign-popover.tsx` reused in System Users.
- DB (live `nakvdkkezgdqxytygtqp`): added enum values; SECURITY DEFINER RPCs `set_user_role` (admin) and `set_user_sites` (admin/ops/payroll); `profiles_select_tenant` SELECT policy (fixes cross-user reads that were previously RLS-blocked). `admin.users` now routes role/site writes through these RPCs. Migration `20260622120000_security_supervisor_role.sql`.
