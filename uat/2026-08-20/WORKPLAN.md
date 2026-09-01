# UAT 2026-08-20 — readiness evaluation & work plan

**Source of decisions:** [`DECISIONS.md`](DECISIONS.md)
**Evaluated against:** `main` @ `f2a323e` (Complete UAT Group B), live Supabase `nakvdkkezgdqxytygtqp`
**Date:** 2026-08-30
**Status:** planning only — nothing in this document has been implemented.

---

## Verdict

**Partly ready. 12 of the 22 decisions can become work today; 6 are decided but blocked;
4 need a prerequisite that does not exist yet.**

The useful surprise is how much of the decided work is *already built*. Group A and B of the
autonomous UAT loop (21–23 Aug) shipped 9 of the 17 UAT items, and several of them turn out
to implement the decisions Philip made a week later. The midnight-split calculation Philip
chose in P-05 has been in `payroll-engine.ts` since before the UAT was written. So the real
shape of the work is smaller than the brief suggests — but it is also different: three of the
already-shipped features bake in assumptions about questions that are **still open**.

| | Count | Meaning |
| --- | --- | --- |
| ✅ Ready to build | 8 | Decided, unblocked, and the code has somewhere to put it |
| 🔵 Ready — verify & lock, not build | 4 | Already implemented; needs a test and a note, not a feature |
| 🔴 Decided but blocked | 6 | The decision is sound; a dependency is still open |
| ⚠️ Prerequisite missing | 4 | Cannot be done properly until the repo gains a test framework |

---

## What the code already does

Read this before planning anything — it changes the size of several items.

| Decision | Already in the code | Where |
| --- | --- | --- |
| **P-05** one stored shift, backend midnight segments | **Fully implemented.** `shiftSegments()` splits a worked interval into one segment per calendar day; `bucketiseLogs()` classifies each segment by its real day and routes Sunday/public-holiday/ordinary hours separately. The roster stores one row. | `src/lib/payroll-engine.ts:239`, `:282` |
| **D-01/D-02** midnight-split boundary | The midnight split **is** the current behaviour — but hardcoded, not configurable. | `src/lib/payroll-engine.ts:239` |
| **P-04** one shift per calendar date | **Enforced at the database**, on every write path, by a `BEFORE INSERT OR UPDATE` trigger. | `supabase/migrations/20260818230341_roster_assignment_integrity.sql` |
| **D-09** no extra rest-gap rule | Existing rules are exactly the set Philip confirmed: 60h weekly cap (with PS-exemption cover), six-workday weekly rest, Night→Day and Day→Night conflict blocks. **The correct action is to add nothing.** | same migration |
| **D-03** standing contract consent, no per-Sunday opt-in | **This is already how the engine behaves** — `sunday_agreed_multiplier` (1.5×) applies to every rostered Sunday, with no per-employee opt-in consulted. The code comment already flags it as a tenant policy rather than a product default. | `src/lib/payroll-engine.ts:488` |
| **D-19** never auto-forfeit annual leave | **Already true and deliberate.** `ensure_statutory_leave_cycles()` expires sick and compassionate balances at cycle end and explicitly leaves annual leave alone. | `supabase/migrations/20260803181750_leave_management_module.sql:337` |
| **D-08** premium cap | Fairness *ranking* exists (prefers guards with fewer recent Sunday day shifts). The **cap itself does not** — deliberately, because UAT-07 was undecided. | `src/routes/_app.schedule.tsx:447`, `:814` |
| Sunday call-in vs rostered | Already separated end to end: `is_replacement` → `sunday_callin_hours` at 2× vs `sunday_hours` at 1.5×, itemised on the payslip. | `src/lib/payroll-engine.ts:493` |

**Nothing here needs rebuilding.** Four of these need a regression test so they cannot silently
regress, and one (D-01) needs a configuration seam added around behaviour that already works.

---

## ✅ Ready to build

### A1 — Make the Sunday boundary rule configurable *(D-01, D-02 · critical · small)*

The behaviour is right; the seam is missing. Add a `sunday_boundary_rule` payroll constant
(`'midnight_split'` default, `'majority_of_shift'` the alternative), read it in
`bucketiseLogs()`, and branch: midnight-split keeps the current per-segment classification;
majority-of-shift assigns the whole shift to the day holding more than half its minutes.
D-02 means **no tie-breaker code** — under midnight-split a tie cannot arise, and if
majority-of-shift is ever selected the tie case comes back to the client.

- Touches: `src/lib/payroll-engine.ts`, `src/lib/payroll-data.ts` (constants map), a seed migration.
- Do **not** change the default. The client has not chosen; the point of the decision was to
  stop the choice being load-bearing.

### A2 — Surface the calculation segments *(P-06 · high · medium)*

The segments exist inside `bucketiseLogs()` and are discarded — only bucket totals survive into
`PayslipCalc`. P-06 requires them visible in the payroll breakdown and the audit trail.

- Return a per-shift segment list (`date`, `minutes`, `night_minutes`, `classification`,
  `multiplier_applied`) alongside the buckets, persist it with the payroll run, and render it
  under the existing per-category breakdown on the Payroll page.
- Roster display must not change — one shift stays one shift.
- Touches: `src/lib/payroll-engine.ts`, `supabase/functions/run-payroll/index.ts`,
  `src/routes/_app.payroll.tsx`, a migration for the stored breakdown.

### A3 — Manual Sunday base rate entry *(P-01 · high · medium)*

New: a per-period, per-employee Sunday base rate that payroll enters by hand, rather than the
engine deriving it from `hourly_rate`.

- New table (tenant + pay period + employee + rate + entered_by/at), read by the `run-payroll`
  edge function and passed into `calculateNetPay()`.
- Server-authoritative like the rest of payroll — the browser must not be the writer of record.
- Touches: migration, `supabase/functions/run-payroll/index.ts`, `src/lib/payroll-engine.ts`,
  `src/routes/_app.payroll.tsx`.

### A4 — Rate validation, warning and acknowledgement *(P-02, P-03, P-07, P-08, P-09, P-10, P-11, P-12 · high · large)*

The single biggest piece of work in the brief, and entirely new scope — none of it appears in
`UAT.md`. Eight decisions describe one coherent workflow:

1. Compare the entered Sunday base rate against the employee's calculated ordinary rate (**P-02**).
2. Differ → warn, never block on the difference alone (**P-02**).
3. Warn at entry **and** again at submission (**P-07**).
4. An authorised user must acknowledge before payroll can be submitted (**P-03**).
5. The acknowledgement is enough — no second senior approval (**P-12**).
6. Reason/comment optional, recorded when given (**P-09**).
7. Acknowledgement covers **this submission only** (**P-08**).
8. Change the rate → the old acknowledgement dies, a new one is required (**P-10**).
9. Rates match → record that validation passed, require no acknowledgement (**P-11**).

- The gate belongs on `finalize_payroll_period` (and/or the draft-replace path), not in the UI —
  the UI mirror is a convenience, the database is the enforcement point. This matches how the
  repo already handles payroll locks.
- Audit record needs: user, timestamp, both rate values, the validation result acknowledged,
  optional reason.
- "Authorised user" should reuse the existing role model (`payroll`, with `admin` fallback), the
  same pairing `replace_draft_payroll` / `finalize_payroll_period` already use.
- P-10 implies the acknowledgement must be keyed to the rate values, not just the period — a
  stored hash or a copy of the acknowledged values, checked at submission.

### A5 — Leave capacity cap *(D-15 · high · medium)*

Nothing like this exists today. Both halves of the decision:

- **Tenant-wide:** configurable maximum (default 10) employees on annual leave in a calendar
  month, with an effective date and policy owner per `UAT_REQUIREMENTS.md` §7.
- **Per-site, day-level:** coverage check on each day of the requested range, at the employee's
  home site.
- Enforce against approved *and* planned annual-leave days at the approval point in
  `approve_leave_request`; show the approver both numbers before they decide.
- Reuse: the leave planner's existing site coverage-risk helper (`src/routes/_app.leave.tsx`) and
  `leave_coverage`.
- **Stop at the warning.** What happens when the cap collides with a statutory deadline is
  **D-16, still open** — see the blocked list. Build the check and the display; do not build the
  resolution path.

---

## 🔵 Ready — verify and lock, don't build

These are decisions that the code already satisfies. The work is a regression test plus a line
in the docs, so that a future change cannot quietly undo a decision Philip made deliberately.
All four are gated on **P0** below.

| Ref | What to assert |
| --- | --- |
| **P-04** | A second working shift on the same calendar date is rejected by the database, on every write path. |
| **D-09** | No minimum rest-gap rule exists or is added. The Night→Day / Day→Night conflict checks are **not** an 11-hour gap and must not be relabelled as one. |
| **D-19** | An annual-leave balance survives cycle rollover untouched. Sick and compassionate still lapse — confirm with Philip that this asymmetry is intended, because D-19 only ever asked about annual. |
| **D-03** | A rostered Sunday pays 1.5× and a call-in Sunday pays 2×, with no per-employee consent flag consulted. |

---

## 🔴 Decided, but blocked

Do not start these. Each is a sound decision waiting on something nobody has answered.

### D-08 — premium cap hard block *(blocked on D-07 and D-10)*

Philip decided *how* the cap behaves: hard block with a senior override. Nobody has decided
**what the cap is** (D-07: one per calendar month? what window? fixed or configurable?) or
**who may override it** (D-10: which role, and may statutory limits ever be overridden at all?).
A hard block cannot be written without its threshold, and an override workflow cannot be written
without its authority. Both are on the client/legal list.

*When it unblocks:* the record→verify→confirm chain in `src/lib/approvals.ts` is the natural
model for the override — it already enforces that one person cannot fill two roles.

### D-04 — the 1.5× fallback *(blocked on an undecided half of D-03)*

D-04 says: fall back to 2× when "valid contract consent **or required records**" are missing.
The consent half is answerable — `employees.contract_signed_at` is a usable anchor, and a null
there is a clean trigger for the fallback.

**The "required records" half has no answer.** The Labour Act test for the reduced 1.5× rate has
two limbs: the employee's agreement *and* equal time off. Keeper's recommendation was standing
consent **plus a per-Sunday link to the comp-rest day actually rostered**; Philip's answer
addressed only the consent limb. There is no comp-rest data model in the repo and no decision
about whether one is required. As it stands, D-04's fallback would fire on a condition that has
not been defined.

*What is needed:* a decision on whether equal time off must be evidenced per Sunday, and if so,
what counts as evidence. Until then, the consent-only fallback can be built but must be labelled
as covering one limb of the statutory test, not both.

### P-13 / P-14 — leave expiry handling *(blocked on policy, and in tension with D-19)*

P-13 flags leave as expired at its "expiry threshold"; P-14 moves expired leave into a separate
balance. Two problems:

1. **There is no defined expiry threshold for annual leave.** `leave_cycles.latest_leave_date`
   (cycle end + 4 months, Labour Act s.23) is a *statutory scheduling deadline for the employer*,
   not an expiry date for the employee's leave. Treating it as expiry is precisely the legal step
   `UAT_REQUIREMENTS.md` says must not be encoded without labour-law review.
2. **Tension with D-19.** Philip decided leave must never be automatically forfeited, then seven
   minutes later decided expired leave moves to a separate balance. These reconcile only if the
   expired bucket is *presentational* — visible, auditable, still legally owed, and never netted
   off entitlement. Build it any other way and it is automatic forfeiture wearing a different name.

*What is needed:* the client and labour counsel to define whether and when annual leave lapses.
Until then the honest build is the at-risk flag (Keeper's own recommendation on D-19), not an
expired balance.

---

## ⚠️ Prerequisite — P0, do this first

### P0.1 — There is no test framework in this repo

`package.json` has `lint`, `build`, `format`, and three `verify-leave-*.ts` scripts that run
against the **live database** via `tsx`. There is no unit test runner and not one test file.

Every item above asks for regression coverage, and A1–A4 all touch `payroll-engine.ts` — 610
lines of pure, deterministic, entirely untested money arithmetic. It is the best possible
candidate for unit tests and the worst possible thing to keep changing without them.

- Add `vitest`, and write the first suite against `payroll-engine.ts` before touching it:
  same-day shift, Sat→Sun, Sun→Mon, multi-midnight, exact midnight boundary, zero/negative
  duration, night-band isolation, segment totals equalling shift duration, no double-counted
  minute, weekly cap split, rostered vs call-in Sunday.
- These are characterisation tests: assert what the engine does **today**, before any change.
  That is what makes A1 and A2 safe.

### P0.2 — Confirm the live schema before writing migrations

`CLAUDE.md` is explicit that the live Supabase schema has diverged from the migrations folder,
and `supabase/schema-baseline-2026-07-05.sql` is the real migration zero. A3, A4 and A5 all add
tables. Diff against the baseline plus everything after it, not the folder alone — the leave
module already lost a day to exactly this class of bug (missing helper functions,
`20260807003500`).

---

## The thing worth flagging

Three shipped features encode assumptions about questions that are still open.

| Shipped | Assumed | Actually still open |
| --- | --- | --- |
| **UAT-06** fairness ranking (23 Aug) | A "premium opportunity" = a **Sunday day shift**, over a hardcoded **90-day** trailing window (`PREMIUM_HISTORY_DAYS = 90`) | **D-06** — what counts as a premium opportunity (Keeper's steer was Sunday day shift *plus public holidays*). **D-07** — the window; the client's own proposal was **one per calendar month**, not 90 days. |
| **UAT-16** Sunday & premium report | Per-employee totals sorted by premium pay, with CSV export | **D-20** — what the report must show. Keeper's steer included a **fairness outlier flag**, which is the part that makes the report worth reading; it was not built. |
| **UAT-10/12** shortage register & leave planner | Full detail, 30-day report card, 90-day leave warning horizon | **D-12** — register contents and *who receives a scheduled weekly report* (currently on-demand only). **D-18** — planner horizon and audience. |

None of this is wrong, and the schedule code is honest about it — the fairness ranking's own
comment says the hard cap "would be UAT-07's still-undecided" call. But the 90-day window is a
number nobody chose, sitting where a client policy belongs, and it will quietly become the
policy if the question is never re-asked.

**Recommendation:** when the remaining 13 questions go back to Philip and the client, put
D-06, D-07, D-12, D-18 and D-20 at the front and frame them against what was built, not from
scratch — "the ranking currently looks back 90 days; your proposal was one per calendar month;
which is it?" is a far easier question to answer than the original.

---

## Suggested sequence

1. **P0.1** — vitest + characterisation tests on `payroll-engine.ts`. Nothing else starts safely first.
2. **P0.2** — schema baseline diff.
3. **A1** — Sunday boundary configuration seam (small, high value, fully covered by step 1's tests).
4. **A2** — segment visibility.
5. **A3 → A4** — manual Sunday rate, then the validation/acknowledgement workflow. One stream, in that order; A4 has no meaning without A3.
6. **A5** — leave capacity cap, warning only.
7. **🔵 verify-and-lock tests** (P-04, D-09, D-19, D-03) — can run in parallel with any of the above once step 1 lands.
8. Everything red stays untouched until its dependency is answered.

**Do not implement any of this yet.** This is the plan; the build is a separate decision.
