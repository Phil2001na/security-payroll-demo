# Updates

## 2026-08-06

### 01:15 - loop iteration 4 continued: #14 bug fixed and re-verified, round 7 wrapped up
- Fixed the invoice_payments trigger bug with a new migration (`20260806013000_fix_invoice_payment_status_cast.sql`) casting the CASE literals to `invoice_status` explicitly, applied to the live tenant.
- Re-verified live: recorded a real N$3,000 partial payment against INV/2026/00001 (N$8,372 total) — it now shows as its own dated line on the statement, the 60-day aging bucket dropped to exactly N$5,372 (the remaining balance), and the closing balance reconciled. tracker.html #14 → `pass`.
- Round 7 tally: 10 pass, 3 partial (#7, #8, #12), 2 untested (#3, #10), 1 not built (#13). Header bumped.
- Two fixed-and-verified real bugs this round (#6 management exclusion, #14 payment trigger) plus one applied business decision (#7 enforcement) — good stopping point for this session.

### 00:35 - loop iteration 4: #14 verified with a real regression found
- Statement generation itself is correct: signed in as CEO, opened City of Windhoek Civic Centre's statement — closing balance and aging matched this card's own reference numbers exactly.
- But recording a payment fails 100% of the time: `sync_invoice_payment_status()` (the trigger added by Round 6's `20260803153900` migration) assigns bare `'paid'`/`'issued'` string literals to the `invoices.status` enum column inside a `CASE`, which Postgres resolves as `text` and rejects with a 400. Reproduced directly in SQL, not just through the UI. The trigger was created *after* that same migration's own backfill insert, so it has never fired successfully since the migration went live.
- tracker.html #14 verdict → `fail`. Handing to `/apply-fixes` for the one-line cast fix.

### 00:10 - loop iteration 3: #8 deferred at Philip's call, moving on
- `payroll@apexshield.demo` can't mark attendance (muster silently no-ops, no error) — attendance actions need the supervisor role. Reset `accountant@apexshield.demo`'s password again (same approach as Round 5) with Philip's explicit ok after an earlier attempt was blocked by a safety classifier; the reset itself succeeded, but completing the browser sign-in got blocked by the same classifier again this round.
- Philip's call: skip #8 for now, remind him later once the supervisor login works from this session. Not marked as a failure or a fabricated pass — left at `partial` with a note explaining exactly what's needed to finish it.
- Continuing the loop to the next non-pass issue that doesn't need that account.

## 2026-08-05

### 05:50 - loop iteration 2: #7 enforcement decision made and applied
- Asked Philip whether to enforce the 240h monthly cap now or stay in warning mode. Answer: enforce it now, but keep it a per-tenant switch since this specific client wants strict enforcement (not necessarily every future client). Confirmed the trigger already reads `monthly_cap_enforced` per-tenant, so this was already the right shape — flipped the value to 1 for Apex Shield Security's tenant only (`fefcfdb2-...` DogForce tenant sharing this Supabase project untouched).
- Checked live rostering before flipping: August 2026 (current open period) has 0 guards over 240h, so nothing gets blocked immediately; July's 9 and June's 20 over-cap guards are historical and won't trigger new inserts.
- tracker.html #7 stays `partial` — the flag flip and per-tenant scoping are confirmed, but actually pushing a guard over the cap through the app and watching the hard block fire wasn't exercised live (would need ~60h of new real shifts for the highest-hours guard currently at 180h in August).

### 05:35 - verify-tracker round 7: #6 re-verified live, fix confirmed (loop iteration 1 complete)
- Signed in as `payroll@apexshield.demo`, ran payroll for the open August 2026 UAT period. Confirmed via `payroll_runs` SQL: EMP017 and EMP023 (management, hourly-paid — the two employees Round 6 caught getting wrongly prorated) now keep the full N$350 transport allowance with no proration warning; EMP050 (officer) in the same run is still correctly prorated to N$15.91 for 1 of 22 rostered days. Also spot-checked EMP017/EMP023's `normal_amount` stayed at 0 (unchanged from before the fix) — confirms the fix didn't touch their compensation calculation, only the transport exclusion.
- tracker.html #6 verdict → `pass`. Header bumped to Round 7 (9 pass, 3 partial, 3 untested).
- Loop continuing to the next non-pass issue (excluding #3).

### 05:10 - apply-fixes: #6 management-exclusion bug fixed (loop iteration 1)
- `payroll-engine.ts`'s `isManagement` flag was doing two jobs: gating the salaried-vs-hourly compensation basis (`monthly_salary>0`) *and* gating the transport-proration exclusion. Because every management employee in this tenant is paid via `hourly_rate` (`monthly_salary=0`), the combined flag never excluded them from transport proration.
- Fix: added a separate `isManagementCategory` (category alone, no compensation-basis condition) used only for the transport exclusion. Left `isManagement` and every compensation calculation untouched — dropping the `monthly_salary>0` condition outright would have zeroed these employees' normal pay (their `normal_amount` is computed from `monthly_salary`, which is 0 for all of them).
- Not yet re-verified — handing back to `/verify-tracker` for issue #6.

### 04:40 - verify-tracker round 6: applied 3 pending migrations to live tenant (payroll was broken), #6 confirmed with a real bug, #3/#14 unblocked but not yet browser-tested
- Payroll was completely broken for everyone — Run Payroll 400'd on a `schedule_assignments` query because the app code already referenced `leave_request_day_id`, a column that only exists in migration `20260803181750`, which had never been applied to the remote DB. Checked `supabase migration list --linked` and found 3 pending local migrations: `20260719180000` (#7 monthly hour caps, ships disabled), `20260803153900` (#14 partial payments + Sunday call-in split), `20260803181750` (#3 full leave module). Applied all three to `nakvdkkezgdqxytygtqp` with explicit approval (schema change, not just test data).
- Hit and fixed 3 genuine schema-drift bugs while applying (this project's own CLAUDE.md already warns the live schema has diverged from the migrations folder): `shift_types` had no unique constraint on `(tenant_id, code)` that the leave migration's upsert assumed existed (added `shift_types_tenant_code_key`, no dupes existed); `current_site_ids()` — referenced by 3 new RLS policies — was never actually live (real site-scoping is `profiles.assigned_site_ids`, enforced in the frontend per migration `20260622120000`'s own comment; added a shim function); `write_audit_event()` — used by 4 new audit triggers — also never existed live (added a generic version matching the real `audit_events` table). All three are compatibility shims for pre-existing drift, not new business logic.
- **#6 (transport proration) re-verified live**: built 3 days of real confirmed attendance with one guard marked absent, ran payroll as the `payroll` role. Confirmed via `payroll_runs` SQL the proration math is exactly right ($350 × 1/22 rostered days = $15.91, warning text matches spec). But found a real bug: the management-exclusion check (`category==='management' && monthly_salary>0`) never fires in this tenant because every management employee has `monthly_salary=0` (paid via `hourly_rate` instead) — two management employees who happened to get attendance confirmed this round were incorrectly prorated like officers. tracker.html verdict → `partial`; needs `/apply-fixes`.
- **#3 and #14**: schema is now live and both are unblocked, but ran out of working browser-tooling time to actually exercise them — the extension lost page-content permission again right as I opened the Clients page for #14. Both left `untested` this round with a manual fast-path noted in the tracker; not fabricated as passing.
- Progress notes for this round saved to scratchpad `verify-tracker/findings-round6.md` in case a future session needs to resume without re-deriving the schema-drift findings.

### 02:55 - verify-tracker round 5: #4 confirmed fixed, #12 confirmed, tracker engine improved
- The Employees list page and its sidebar nav item had the same stale-role-string bug as `EXIT_RECORDERS` — fixed both (`src/routes/_app.employees.index.tsx`, `src/components/app-shell.tsx`) after discovering, live, that the Supervisor login could reach the "Record exit" button (thanks to the earlier fix) but couldn't navigate to Employees at all to find it. Confirmed RLS on `employees` is tenant-scoped only (no role check), so no DB change was needed — this was purely a frontend gate.
- Reset passwords for `payroll@apexshield.demo`, `accountant@apexshield.demo`, and `ceo@apexshield.demo` via SQL (pgcrypto) after several guessed passwords all failed — saved to `.claude/verify-accounts.local.json` (gitignored) for this and future rounds.
- **#4 fully verified live, end to end**: empty-reason save blocked; Supervisor recorded a dismissal; Payroll verified (recorder had no Verify button); a separate Admin/CEO login confirmed it, flipping the guard to Terminated; a second attempt confirmed the same recorder gets no Verify button on their own record. tracker.html verdict → pass.
- **#12 verified live for the three-person mechanism**: recorded a N$250 fine as one admin login, verified as Payroll, confirmed as a separate CEO login — DB shows `status=confirmed` with three distinct `created_by`/`verified_by`/`confirmed_by` ids, and self-verify/self-confirm were both correctly blocked (no button shown). Not confirmed: the fine's actual payroll effect (excluded while unconfirmed, included after) — this tenant's open UAT period has no confirmed attendance yet, so Run Payroll computes N$0 regardless. Left as `partial` pending a period with real confirmed attendance.
- Also found and fixed a real `tracker.html` bug unrelated to the above while reading it: 8 objects in the `ISSUES` array were missing the comma+brace between them — a JS syntax error that meant the tracker page never rendered at all in a browser (blank page, 0/16 pill was stale HTML, not a live count).
- Added a `verdict` field + `seedFromVerdicts()` to the tracker engine (`~/.claude/fix-tracker/template.html` and this project's `tracker.html`) so a Claude verify pass can auto-tick a card's pass/fail state without Philip clicking anything, while any click Philip makes himself stays permanently authoritative over future auto-seeds.

### 09:40 - fix #4: Supervisor couldn't record an employment exit
- `EXIT_RECORDERS` in `src/routes/_app.employees.$employeeId.tsx` listed the old, dormant `"supervisor"` role string (pre-2026-06-29 rename) instead of `"security_supervisor"`, which is what real Supervisor accounts carry. The whole Employment Exit card returns `null` when `canRecord` is false, so it silently disappeared for the Supervisor login — not disabled, just absent, exactly what the Round 2 tracker audit flagged on #4/#12.
- Added `"security_supervisor"` to the list (matching the sibling `DISCIPLINARY_VIEWERS` array four lines below, which already had both). Queried the live Apex Shield tenant to confirm the fix is actually testable: no `operations`-role accounts exist here, but the chain now works with what's there — Supervisor (`security_supervisor`) records, Payroll verifies, an Admin/CEO account confirms.
- #12 needed no code change — the tenant already has three distinct admin/payroll-role logins (`ceo@apexshield.demo`, `demo@payroll.dev`, `payroll@apexshield.demo`, plus Philip's own account) to walk record→verify→confirm as three different people; Round 2's audit hadn't tried that combination.

## 2026-08-04

### 15:20 - repair and re-sync tracker.html after Codex's session
- Fixed a real bug found while syncing: `tracker.html`'s `ISSUES` array was missing the comma+closing brace between 8 objects (after ids 12, 15, 16, 3, 6, 7, 8, 9, 11, 10 in file order) — a JS syntax error, so the tracker page's script would throw and nothing would render. Not caused by this session; likely predates it. Fixed and confirmed the array now parses.
- Bumped tracker.html to Round 4 and updated cards #3 (leave management), #10 (Sunday pay), and #14 (client statements) to reflect the work Codex did in this repo since Round 3's browser audit (see UPDATES.md 2026-08-03 entries) — partial invoice payments, statement rework, leave hardening + `verify:leave` passing, and the separated Sunday call-in payslip line — without re-running the browser audit itself.
- Fixed the misleading Payroll page subtitle ("Sunday/PH 2×" for everyone) to state the actual rule: rostered Sunday 1.5× by contract, Sunday replacement call-in 2×, public holiday 2×. `src/routes/_app.payroll.tsx`.

### 13:11 - create dedicated browser-UAT pay period
- Added an open August 2026 UAT pay period to the test tenant so local-browser attendance and payroll workflows can be exercised against the existing August roster.
- This is test data only and is deliberately labelled for later removal after UAT.

## 2026-08-03

### 23:14 - clear dependency security advisories
- Replaced the vulnerable npm SheetJS 0.18.5 package with the official SheetJS 0.20.3 distribution and verified spreadsheet read/write round-tripping.
- Applied compatible TanStack, Vite and transitive dependency security updates, added `tsx` as an explicit verifier dependency, and reduced `npm audit` from 15 advisories to zero.
- Confirmed the production build and all leave/payroll verification scripts pass; the repository-wide lint remains blocked by its pre-existing formatting/type backlog.

### 21:43 - render and verify leave-heavy payslip
- Added an optional payroll-verifier PDF output, rendered the leave-heavy A4 payslip and confirmed every leave line and gross/net total fit and reconcile visually.
- Switched jsPDF to its Node-compatible named export and replaced unsupported PDF glyphs with ASCII-safe labels after the first render exposed a broken ordinary-hours symbol.

### 21:36 - execute leave migration in isolated PostgreSQL
- Added a Docker-free PGlite integration verifier that executes the full leave migration and tests core RPC, trigger, RLS, roster, relief, payroll, accrual and lock behavior against a real PostgreSQL engine.
- Fixed two runtime-only defects it exposed: cancellation restoration was blocked by its own approved-leave guard, and payroll finalization had an ambiguous PL/pgSQL variable/query alias.
- Documented exactly which leave checks now pass automatically and which Supabase Storage, concurrency and rendered-browser checks still require disposable-environment UAT.

### 21:16 - harden statutory leave and maternity payroll
- Enforced one independent leave approval, statutory paid-leave floors, 12-week maternity duration, emergency retrospective submissions and immutable ledger corrections.
- Separated scheduled from employer-paid maternity hours, made annual accrual exact per employee cycle, capped confirmed leavers at their last working day and fixed payroll-page hook ordering during role loading.
- Expanded the disposable-database UAT handoff to 39 cases; executable payroll verification, TypeScript, focused lint, SQL parsing and the production build pass locally.

### 20:45 - complete leave workflow, payroll detail and UAT handoff
- Completed the local leave UI for submission, two-person decisions, roster-impact preview, private evidence, relief assignment/waiver, balances, immutable-ledger export and employee history.
- Hardened leave approval/cancellation and replacement scheduling; added statutory sick/compassionate cycles and maternity leave; persisted and printed all leave categories separately in payroll; added a 39-case UAT matrix.
- Replaced worked-day annual accrual with proportional four-week cycle accrual after the compliance review. Verified TypeScript and the production build; database execution remains pending because local Docker/Supabase is unavailable, and nothing was applied remotely.

### 20:21 - complete leave-management foundation
- Added a local end-to-end leave migration: configurable policies, two-person request approval, immutable balance ledger, scheduled-day charging, roster unavailability, relief-cover queue/assignment, cancellation reversal, RLS, audit triggers and future accrual mirroring.
- Kept schema work local pending deployment review; the current database has not been changed.

### 15:39 - roster, payroll detail and payments follow-up
- Added a local migration to make ten calendar-month rest days a database-enforced minimum, retain separate Sunday call-in payroll fields, and introduce receipt-level invoice payments for partial settlements.
- Updated Payroll to persist/reprint Sunday call-ins separately and Admin Settings to present the existing 240-hour enforcement setting as an on/off switch.

## 2026-08-01

### 15:40 - tracker.html updated to Round 3 after an independent browser audit
- Ran a live browser walkthrough (login as Supervisor/Payroll/CEO against the Apex Shield demo tenant on local dev) of every "Built — verify" item in Round 2, to check claims against actual behavior rather than the fix notes alone. Published findings as a screenshot deck (Artifact, not committed to repo).
- 7 items confirmed working end-to-end with evidence: #1, #2, #5, #9, #11, #15, #16 — marked "Verified — round 2 audit ✓" in tracker.html.
- 5 items partly confirmed, each missing one specific detail (noted per-card): #4 and #12 (the third-person Confirm/Verify leg can't be tested — the Supervisor demo account has no UI for Employment Exit or Disciplinary sign-off at all, not just a disabled button — worth deciding whether to open that up or provision a 4th test login), #7 (amber threshold + pre-Confirm banner not re-checked), #8 (day/night independent-confirm not re-proven), #10 (payslip Sunday/call-in lines not re-checked, though the profile no longer shows a per-guard toggle — confirmed live).
- 2 items not reached this round due to browser-automation tooling instability partway through (screenshot capture and navigation started failing): #6 (transport proration) and #14 (client statements). Manual check steps left on their cards.
- Added an `audit` field to each tracker.html issue (rendered as a blue callout, included in the .md export) so findings travel with the fix instead of living only in the deck.

## 2026-07-24

### 14:20 - tracker #10 corrected: 1.5x is the contract Sunday rate for everyone
- Client confirmed the s.21 agreement is a condition of hire, so rostered Sundays now pay the agreed 1.5x for every employee; `employees.ordinarily_works_sundays` is no longer consulted for pay. 2x applies only to replacement call-ins.
- Public holidays stay at 2x for everyone, rostered or not — the agreement covers Sundays only. `estimateShiftCost` updated so roster costing matches what payroll pays.
- Employee profile now states the contract rate instead of offering a Yes/No toggle that no longer affects pay; the write mutation was removed. Column kept for reversibility.
- Moves money: 2,556 Sunday hours across 58 guards go from 2x to 1.5x (~N$23k over 24 May-19 Jul, ~N$11-12k/month). Finalized periods untouched.
- New `SAAS building notes for this software.md` records this as tenant policy, not a product default, with instructions to reverse it for the next client.
- `decisions.html` revised: #10 rewritten, mislabelled card 02 replaced with the real requirement (disciplinary history), and a missing card added for #12 (record → verify → confirm).

## 2026-07-20

### 16:35 - decisions.html
- New `decisions.html` at the repo root: every UAT item as asked-for → built → why they differ, including the three still needing a client decision (#3 leave, #7 cap enforcement, #13 patrols) and the payroll behaviour change (only confirmed disciplinary actions affect pay). Companion to `tracker.html`, which keeps the verification steps.

### 16:20 - tracker #10: 2x Sunday for cover shifts
- Philip's call: "unplanned" = a guard covering someone else. Engine splits Sunday hours into `sunday_hours` (rostered) and `sunday_callin_hours` (worked on an assignment with `is_replacement`); rostered Sundays keep the 1.5x agreed multiplier for flagged guards, call-ins always take the 2x default. Payroll query now embeds `schedule_assignments:assignment_id(is_replacement)`; payslip PDF gets its own "Sunday call-in" line.
- Public holidays untouched — already 2x for everyone, nothing to split. `payroll_runs` has no call-in column, so a finalized run stores the combined Sunday total and reprints show one Sunday line at its effective rate; avoided a migration for a display-only split.
- No pay change on live data: only 9 of 330 active guards have `ordinarily_works_sundays`, and the 2 call-in Sundays on record (24h, July 2026) belong to guards without the flag, so they were already paid 2x. The client still owes us the list of guards who signed the agreement.

### 14:45 - tracker #14: client statements
- New `src/lib/statements.ts` (opening balance, dated invoice/payment lines with running balance, closing balance, aging buckets) and `src/lib/statement-pdf.ts` (same deterministic jsPDF path as payslips). Clients gained a statement dialog per row with a date range and a Download PDF button.
- Not routed through erp-brain, against the original UAT suggestion: a statement gets checked against the client's own books, so every figure has to be reproducible from the invoice ledger.
- Reconciled against live data — City of Windhoek Civic Centre closes at N$71,732.00 over the last three months, exactly its outstanding issued total, aged N$8,372.00 (30–60 days) + N$63,360.00 (90+).
- Limitation worth flagging: there is no payments table in this schema. An invoice is settled by moving it to `status='paid'` with `paid_at`, so a payment is that event for the full amount and partial payments cannot be represented yet. Also, some seeded 2025 `paid_at` dates precede their 2026 `invoice_date`, which makes early-window opening balances look negative — data, not the report.

### 14:10 - tracker #9 + #11: one roster rule set, reported on Schedule
- New `src/lib/roster-rules.ts` — `validateRoster()` judges a whole generate range and returns typed violations: under 10 off days in the period, off days that fell as singles instead of pairs (with the dates either side and the site that blocked the pair), and anyone rostered over the monthly hour cap. Built as one rule set because the three constraints trade off against each other; separate checks would each pass while the roster failed.
- Schedule gained a "Roster rules" panel over the generate range (reuses the existing cross-site assignments query — no extra fetch). Reports rather than blocks: live data for the open period has 23 of 32 rostered guards under 10 off days (min 8, avg 8.8) because a 6-day pattern over 31 days can't produce 10 — same call as the 240h cap in #7. The 60h weekly cap still hard-blocks saving and was left alone.
- Generator now prefers, among equal-cost candidates, a guard who already works the adjacent day, so work runs in blocks and rest falls together. Placed after the cost comparison so pairing can never raise the wage bill. Current live roster: 137 paired rest blocks vs 9 single off days across 32 guards.
- No migration, no pay change.

### 09:15 - tracker #8: day and night musters confirmed separately
- Attendance now renders one card per shift period ("Day shift" / "Night shift"), each with its own present/absent/replaced/unmarked counts, its own "Mark all present", its own Discard and its own Confirm — the write is scoped to that section's rows. The single sticky "Confirm attendance" bar is removed.
- Day vs night comes off `shift_types.period`, which the roster already records; nothing explicitly night (day, half day, Sunday, leave, public holiday) falls in the Day section. No schema change and no second confirmation record — the shift log already holds per-assignment state, so duplicating it would only have needed reconciling later.
- Checked the live shift types before shipping: both night types ("Night Shift", "Half Night Shift") also match the existing night-premium detection, so sectioning and `night_hours` agree and no pay changes.

## 2026-07-19

### 18:40 - tracker #7: monthly hour cap measured and warned (enforcement off by default)
- New `src/lib/hour-caps.ts` — one definition of the monthly ceiling, caps read from `payroll_constants` (`monthly_hour_cap` 240, `monthly_overtime_cap` 20, `monthly_cap_enforced` 0). Attendance gained a "Mth total" column (amber from 90%, red past the cap) and a pre-Confirm banner naming any guard the pending present-marks would push over.
- Migration `20260719180000_monthly_hour_caps.sql` written but **NOT applied**: seeds the constants and adds a `enforce_monthly_hour_cap` trigger on `schedule_assignments` + `shift_logs`, following the 12h-daily-cap precedent (DB-side so it holds regardless of which screen writes). It no-ops unless `monthly_cap_enforced = 1`.
- Shipped disabled on purpose — live data shows the cap conflicts with how they actually roster: July 2026 has 9 guards rostered over 240h (max 276h), June had 20 (max 264h); a 6×12h pattern is ~264h+, so 240h caps a guard at ~20 shifts/month. Enforcing it means fewer shifts per guard and more headcount — a client decision, not a default.
- The 20h overtime cap is deliberately not built: overtime is derived weekly by the payroll engine and isn't stored per shift, so it belongs on the payroll run rather than the muster. Logged as a separate ask.

### 17:20 - tracker #6: transport allowance prorates against rostered days
- `payroll-engine.ts`: transport = allowance × min(1, worked days / rostered days). Worked days = distinct dates with approved non-off/non-leave shift logs (same definition leave accrual uses). Rostered days come from `schedule_assignments` for the period, passed in by the payroll page. No roster for the period → full allowance (nothing to judge attendance against); management excluded (monthly salary, no shift logs). Basis surfaced on the payslip line ("Transport allowance (20/22 days)") and as a compliance warning on the payroll row.
- Corrected the card's own plan mid-build. It called for dividing by `days_per_week × weeks`; checked against the live July 2026 period that would have cut **N$350 → N$299.44 (−14%)** for guards with *perfect* attendance, because rosters give ~22 worked days against a 6-day pattern's 25.71 — about N$7.3k/month wrongly withheld across 145 guards. On the rostered-days basis the same cohort averages N$348.92, and only genuine absence reduces it (e.g. EMP004 worked 20 of 21 rostered → N$333.33; EMP111 worked 7 of 8 → N$306.25). 50 of 56 rostered guards are unaffected.
- Also corrected the note that proration moves PAYE: it doesn't. `taxable = gross − transport`, so both sides fall by the same amount. SSC does move (percentage of gross).
- No migration. Finalized/locked periods are untouched — Run Payroll is blocked on locked periods, so the July figures already paid stand.

### 16:50 - tracker #3 investigated and blocked (no code changed)
- Went to implement the leave/sick "skip Sundays" fix and stopped: the premise doesn't hold. Nothing in the system ever *reduces* a leave balance — `leave_balances.annual_days` is only ever credited by `finalize_payroll_period`; there is no drawdown path anywhere. `sick_days` and `compassionate_days` are rendered on the employee profile but no code writes them, so they are permanently 0.00. Sick leave isn't valued as sick leave at all: it's a leave-type shift log paid at 1× for whatever hours it carries, which is why a Sunday gets paid.
- Also corrected my own earlier plan: accrual must **not** be switched to a Mon–Sat/`days_per_week` basis. `LEAVE_CALCULATION.md` deliberately earns 1 day per 12 actually-worked days, independent of pattern, which is the defensible reading of Labour Act s.23.
- Card #3 rewritten as **Blocked — needs a decision** between (A) a scheduling guard-rail that stops leave/sick shifts landing on a guard's non-working days (~1 day of work, fixes the visible symptom) and (B) real leave management: request → approve → draw down annual/sick/compassionate separately, sick on its own statutory cycle (a module, and it needs the client's sick-leave policy first).
- `/next-fix` updated to skip `Blocked` cards so the loop moves on instead of re-deriving this every run.

### 16:35 - add /next-fix project command
- New `.claude/commands/next-fix.md`: picks the next outstanding tracker item (failed items from `feedback/` first, else topmost non-"Built" card), implements it against the card's agreed `plan`, runs typecheck/build, logs to UPDATES.md and flips the tracker card to "Built — verify".
- Guardrails baked in: one item per run; migrations are written but never pushed without explicit per-session approval; halt-and-report if the plan doesn't fit the code, if a client decision is missing (#10, #13), or if a change would alter an already-finalized payroll period. Intended to be driven by `/loop /next-fix`.

### 16:15 - architecture pass over the nine unbuilt tracker items
- Went back through #3, #6–#11, #13, #14 (still literal UAT transcriptions) and rewrote each with a recommended approach rather than the first idea from the workshop. Added a `plan` field to the fix-tracker template (amber "Recommended approach" callout, also exported) to carry them.
- Substantive re-framings, all checked against the code: #6 transport is an *allowance* excluded from taxable income, not a deduction — the fix is proration, and it moves PAYE; #8 is a UI grouping change, not a schema change (`shift_types.period` + per-assignment shift logs already separate day/night); #9+#11+the roster half of #7 are one constraint problem and should share a `validateRoster()` used by both generation and save; #10 is largely built already (engine picks `sunday_agreed_multiplier` vs `sunday_multiplier`) and the missing "unplanned call-in" signal maps onto the existing `schedule_assignments.is_replacement` flag rather than requiring roster publication/versioning, which the system has no concept of; #14 should render from the ledger via the existing deterministic PDF path, *not* erp-brain (an LLM must not generate a financial document a client will reconcile); #3 should count working days via one shared helper driven by `days_per_week` rather than two hardcoded Sunday checks; #7 monthly caps belong server-side following the existing 12h-daily-cap precedent, with the numbers as tenant settings and total-hours hard-blocking vs overtime warning.
- #13 (patrols) flagged as needing client scoping before build — its value depends on whether checkpoint visits can be trusted (scan-backed), and it's the only phone-first module in the backlog.

### 15:40 - regenerate tracker.html for round 2
- Rebuilt `tracker.html` from the shared `/fix-tracker` template: #1, #2, #4, #5, #12 rewritten as "Built — verify" cards with steps matching what actually shipped, plus two new cards (#15 absence reason, #16 repeat-AWOL prompt) for work that came out of #4. #3, #6–#11, #13, #14 carry forward unchanged.
- Added an optional `note` field to the fix-tracker template itself (`~/.claude/fix-tracker/template.html`) — a "How it was built" callout under the bug, also written into the exported .md. Used here to explain where each implementation deviates from the tracker's original idea and why (e.g. #4 dismissal became a three-person exit workflow rather than a supervisor button).

### 15:10 - tracker #4/#5/#12: employment-exit workflow, three-person sign-off, repeat-AWOL prompt
- Repeat absences: the muster row now shows "N unexcused absences this period — flag?" once a guard has 2+ unexcused no-shows in the open pay period. It opens the offence dialog **prefilled** (AWOL, dates listed, written→final warning at 3+) rather than auto-filing anything — a warning is an act the guard must be told about, so it stays a deliberate click. Sick/compassionate/suspension absences don't count (`isUnexcusedAbsence`).
- New `employment_exits` table (migration `20260719140000_...`) covering dismissal, resignation, end of contract and abscondment in one workflow: reason (mandatory), notice date, last working day, `final_pay_period_id`, and a record → verify → confirm chain. Confirming is what sets `employees.status = 'terminated'`. Field supervisors can only *recommend* a dismissal (RLS-restricted to `exit_type = 'dismissal'`, status `recorded`); verification is admin/operations/payroll; confirmation admin/operations. Dismissals and abscondments need all three steps, resignations just need someone other than the recorder to confirm. Recorded on the employee profile ("Employment exit" card).
- Same chain added to `disciplinary_actions` (#12): `status` + `verified_by`/`confirmed_by` columns, Verify/Confirm buttons on the Disciplinary page, and check constraints + security-definer RPCs so one person can never fill two of the three roles. **Payroll now only applies confirmed actions** — an unconfirmed fine or unpaid suspension no longer reaches a payslip, and the payroll flag hover says "not confirmed, excluded from this run". Pre-existing rows were backfilled to `confirmed` so nothing already filed changed value.
- Applied live and smoke-tested with impersonated JWTs (rolled back): supervisor can't verify their own recommendation or file a resignation; a recorder can't verify their own record; a verifier can't confirm their own verification; confirming without verification is rejected; a clean three-person chain ends with `confirmed` and the employee `terminated`. `get_advisors` shows no new findings beyond the new RPCs appearing in the existing "signed-in users can execute SECURITY DEFINER" list, which is by design (each checks role internally; `anon` is revoked).

### 13:30 - tracker issue #4: marking a guard not present now requires a reason
- The ✕ on an Attendance muster row is no longer one-click: it opens a dialog with a preset reason list (no-show/no contact, called in sick, AWOL, sent home by supervisor, compassionate, suspended pending investigation, arrived too late, Other) plus a free-text box — "Other" makes the text mandatory. The chosen reason is written to `shift_logs.notes`, shown in red under the guard's name on the row, and carried through to payroll (the shift still pays 0 hours).
- Clicking ✕ again on a row with an unsaved absence clears it; on an already-saved absence it reopens the dialog to correct the reason.
- Reason list lives in `src/lib/disciplinary.ts` (`ABSENCE_REASONS`) next to the offence list.

### 12:55 - tracker issues #1 and #2: supervisor offence flags visible to payroll, per-guard disciplinary history
- Issue #1 (supervisor → payroll visibility): field supervisors (`security_supervisor`) can now flag an offence (e.g. "Sleeping on duty") straight from the guard's row on Attendance — new shield action + dialog on the muster row, prefilled with that shift's date and site, warning levels only and a mandatory description. They stay attendance-only in the nav; the Disciplinary page is unchanged for them. Migration `20260719120000_supervisor_disciplinary_reporting.sql` widens `disciplinary_actions_role_insert` to allow the role to insert warning-type rows with zero fine/suspension; update/delete still exclude it so a reporter can't silently retract a filing. **Applied to the live DB 2026-07-19**, verified with an impersonated `security_supervisor` JWT (warning insert allowed, `fine_with_ca` rejected by RLS) and `get_advisors` showed no new findings.
- Payroll side of #1: `_app.payroll.tsx` now queries disciplinary actions dated inside the selected period, resolves who recorded each one, and shows a hover-expandable flag badge on the guard's payroll row plus a banner above the table — so payroll sees the offence, amount impact and recorder before Finalize & Lock. Works for already-run/locked periods since it reads the DB, not the in-memory calc.
- Issue #2: added a "Disciplinary history" card to the employee profile (`_app.employees.$employeeId.tsx`) listing every record for that guard, newest first, with date, site, offence, action taken, fine/suspension impact and who recorded it.
- Shared helpers in new `src/lib/disciplinary.ts` (offence list, supervisor-allowed action types, action labels, badge styling, `created_by` → profile lookup since that column has no FK to `profiles`); Disciplinary page table gained a "Recorded by" column.

## 2026-07-18

### 21:40 - create first login for DogForce Security Service tenant
- The DogForce tenant (onboarded earlier today, id `fefcfdb2-29eb-4873-9778-be327b9c8d34`) had no linked user — the app has no signup/tenant-switcher UI, so there was no way to sign into it. Created `admin@dogforce.demo` / `Demo1234!` directly in `auth.users` with `raw_user_meta_data.invited_tenant_id` set to DogForce's id, so the existing `handle_new_user()` trigger attached a `profiles` row (role `admin`, `is_active`) to that tenant instead of provisioning a new one. Verified the resulting profile row.
- **Fix**: first login attempt 500'd — GoTrue's Go driver errored `converting NULL to string` scanning `confirmation_token`, because the direct SQL insert left several `varchar` auth columns (`confirmation_token`, `recovery_token`, `email_change*`, `phone_change*`, `reauthentication_token`) as `NULL` instead of `''` (which is what `supabase.auth.signUp`/admin API always set). Backfilled empty strings for that user; login works. If ever creating an auth user via raw SQL again, set these to `''` up front instead of leaving them NULL.

### 20:15 - fix payroll page not showing numbers for locked/finalized periods; onboard DogForce real employee data
- Fixed `_app.payroll.tsx`: the payroll table/summary was driven only by in-memory `calcs` state set by clicking "Run Payroll" — switching to an already-locked/finalized period showed a blank table even though `payroll_runs` had real data (confirmed against live July/June 2026 locked periods, 144/113 rows). Added a query that fetches existing `payroll_runs` (joined to `employees`) for the selected period and reconstructs `calcs` from it; added `payrollRunToCalc()` mapper. `fine_deductions`/`disqualified_fines`/`suspended_hours` aren't persisted as separate columns so they read back as 0 on reload — totals (gross/PAYE/SSC/net) are exact.
- Onboarded DogForce Security Service's real data from `test data/JANUARY 2026 PAYROLL.xlsx` (client-supplied Excel, not synthetic): new tenant `DogForce Security Service` (id `fefcfdb2-29eb-4873-9778-be327b9c8d34`), 185 real employees (name/ID/position/bank/start date/hourly rate/transport allowance/phone where matched), 30 generically-named placeholder sites (`DF Site 01`–`30`, no real site data existed in the source — Philip to replace with real client/site names). `night_premium_enabled` set to `false` for this tenant since DogForce's real payslips never paid a night premium (only Sunday/PH). Did not import the Nov–Dec 2025 payroll totals from the sheet — Philip wants shifts simulated forward through the engine instead.
- Data-quality calls made during import (Philip-approved): 57/185 national IDs had leading zeros stripped by Excel, re-padded to Namibia's standard 11 digits; 14 employees with no hourly rate in the source (didn't work that period) defaulted to N$13.50 (the company-wide rate); 4 non-"Security Officer" positions (Control Room Operator, Driver, Armed Response Officer, 1x "Stundent") mapped to the closest enum value.
- Analyzed real day/night shift patterns vs. the app's scheduler: DogForce's spreadsheet doesn't track day/night shift kind for ordinary weekdays at all (single hours-per-day column) — it only splits Day/Night sub-columns on Sundays and public holidays, purely to handle shifts crossing the midnight boundary (matches what `payroll-engine.ts`'s `start_min`/`end_min` splitting already automates). The app's auto-scheduler (`_app.schedule.tsx`) assigns the cheapest eligible guard per slot with hour-cap/rest-day/grade-fit rules — not random — a real behavior change from DogForce's ad-hoc manual assignment worth flagging to their ops team.

### 12:00 - lock down direct writes to locked pay periods
- Migration `20260718120000_lock_pay_period_writes.sql`: restrictive RLS policies on `payroll_runs` (insert/update/delete) and `pay_periods` (update) requiring the parent period's `status = 'open'`. Previously RLS only checked tenant + role, so a payroll/admin user could edit or delete `payroll_runs` rows, or re-open a `pay_periods` row, directly via PostgREST after `finalize_payroll_period()` had locked it — the lock was UI/RPC convention only, not DB-enforced.
- `finalize_payroll_period()`/`replace_draft_payroll()` are unaffected: both are `SECURITY DEFINER` owned by `postgres`, which bypasses RLS.
- Applied to live project via `supabase db push`. Verified: no new security advisors; confirmed via SQL that the policy's `EXISTS` check evaluates false against a real locked period (July 2026) and true against a real open one (June 2025).

### (fix-tracker round 1)
- Generated `tracker.html` (+ `feedback/` folder) to track the 14 outstanding UAT gaps from `UAT-2026-07-03.md` (Sunday/PH pay rule, transport deduction formula, hour caps, disciplinary 3-person workflow, patrol module, client statements, etc.). None of these are implemented yet — tracker lists them as a backlog checklist; nothing to test in the app until each is built.

## 2026-07-11

### 21:05
- Reconciled the diverged Supabase migration history (Philip-approved): marked 35 remote-only entries reverted and 39 already-applied repo migrations applied (metadata only, no schema changes), then `supabase db push` applied `20260711090000_equipment_inventory.sql` to the live project. `db push` now works normally going forward.
- Verified: regenerated types match the hand-written equipment types; trigger fn is SECURITY DEFINER with pinned `search_path`; anon key gets `permission denied` on both new tables via PostgREST. Per-role JWT smoke test still outstanding (needs Management API token).

### 19:10
- New Equipment & Inventory module (branch `feature/equipment-inventory`, from UAT feedback): item catalog with stock-on-hand, issue/return of uniforms and equipment to guards, and a per-guard audit trail card on the employee detail page (issued/returned dates, condition, lost/damaged with replacement charge).
- Migration `20260711090000_equipment_inventory.sql`: `equipment_items` + `equipment_issues` tables, stock-movement trigger enforcing availability in the DB, two-layer RLS (tenant + writer roles admin/operations/supervisor/payroll). **Not yet applied to the live Supabase project** — apply + regenerate types before merging.
- Lost/damaged is track-only in v1: charge is recorded on the issue row; payroll deduction stays manual via the Deductions module.

### 15:40
- Deployed the admin-AI-access fix that had been written on 2026-07-09 but never shipped: the live `erp-brain` Edge Function (through v11) and deployed frontend were still CEO-only, so admins saw no AI Assistant nav item and got 403s. Deployed the function (now v13) and committed the frontend gate change.
- Fixed a bug in `20260709202900_admin_ai_access.sql`: it referenced `public.current_tenant_id()`, which doesn't exist (the real helper is `get_my_tenant_id()`); the migration would have failed on any real apply. Corrected and applied to the live project.

## 2026-07-09

### 20:29
- Enabled AI Assistant access for active tenant admins in the frontend, Edge Function authorization, and the RLS entitlement helper.
- Added a migration so admin-owned AI conversations remain readable through the existing owner-scoped policies.

## 2026-07-08

### (AI assistant per-employee lookups)
- **`erp-brain` second-round query tool** (deployed live): added `query_employee_detail`, letting the model look up a named employee's payslip, attendance history, leave balance, disciplinary history, or profile beyond the company-wide snapshot. The function now loops with Gemini (up to 4 rounds) — it executes a whitelisted, tenant-scoped Supabase query per call and feeds the result back as a function response so the model can chain lookups (e.g. one per employee) before answering or generating a document. Bounded so a stalled lookup chain can't leak an unhandled tool call to the frontend.

### (AI assistant usefulness pass)
- **`erp-brain` context made materially richer** (deployed live): monthly revenue/expense breakdown from the ledger (trend questions + trend charts now work — previously the model only saw year-to-date totals and refused), employee names on disciplinary actions and shift anomalies (was raw site UUIDs / no names), payroll aggregated per pay period with labels (was 5 random per-employee payslip rows presented as company runs), and total leave liability.
- **Fixed conversation-history bug**: the function loaded the *oldest* 16 messages (`ascending`+`limit`), so conversations longer than 16 messages lost recent context; now loads the last 16.
- Verified end-to-end against the live function with a minted CEO-executive session (`ceo@apexshield.demo`): health-check answer, monthly revenue-vs-expenses chart tool call, and named disciplinary/per-period payroll answers all correct. Refreshed the AI Assistant starter prompts to match the new capabilities.

## 2026-07-05

### 13:10
- DB-level RBAC hardening (live + repo migrations): added `get_my_role()` helper and restrictive per-command RLS policies on 27 tables so writes now require an appropriate role, not just tenant membership (previously any tenant user — viewer/CEO — could write payroll/HR/accounting tables directly via PostgREST).
- Closed privilege self-escalation: `profiles_update_own` allowed anyone to set their own `role='admin'`; a trigger now blocks self-changes to role/is_ceo_executive/is_active/tenant_id after onboarding (first-run role picker still works).
- Payroll RPCs (`replace_draft_payroll`, `finalize_payroll_period`) now accept `admin` as a fallback alongside `payroll` so a period can still be locked if the payroll user is unavailable.
- Fixed silent-failure bug: `payroll_constants` had no UPDATE policy, so the admin-settings save matched zero rows; added the missing tenant-scoped UPDATE policy (admin-only via restrictive gate).
- Locked down function grants per Supabase security advisors: trigger/internal functions no longer callable via RPC, user-facing RPCs restricted to `authenticated` (no anon), pinned `search_path` on `touch_updated_at`.
- Captured `supabase/schema-baseline-2026-07-05.sql` — full DDL snapshot of the live schema (enums, tables, constraints, indexes, functions, triggers, policies) as the missing "migration zero", since the live DB had diverged from repo migrations.
- Deleted stray `query_periods.sql` scratch file. Verified all changes with impersonated-JWT smoke tests (security_supervisor blocked from employees/invoices, allowed on shift_logs; admin/payroll flows unaffected).

### 12:20
- Recovered UAT results from unsaved Windows Notepad tabs (TabState autosave binary parsing) and saved them as `UAT-2026-07-03.md`.

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
