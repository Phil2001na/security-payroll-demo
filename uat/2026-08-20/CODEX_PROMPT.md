# Codex goal prompt — build the actionable UAT items

Paste the block below as the goal. It is self-contained: the agent needs only this repo.

---

You are working in the `security-payroll-demo` repository — a multi-tenant Namibian security
payroll and rostering app (Vite + React 19 + TanStack, TypeScript, bun, Supabase Postgres).
Read `CLAUDE.md` and `AGENTS.md` before you touch anything.

Your goal is to build every item marked **✅ Ready to build**, **🔵 verify-and-lock**, and
**⚠️ prerequisite** in `uat/2026-08-20/WORKPLAN.md`. That document and
`uat/2026-08-20/DECISIONS.md` are your specification; `uat/2026-08-20/UAT.md` and
`UAT_REQUIREMENTS.md` are the source material behind them. Read all four before writing code.

## Hard boundaries — read these first

1. **Do not implement anything under "🔴 Decided, but blocked" in WORKPLAN.md.** Specifically:
   no premium-cap hard block or override workflow (D-08), no comp-rest / equal-time-off model or
   any fallback that depends on it (D-04's second limb), and no leave expiry, forfeiture, expired
   balance or cash-out (P-13/P-14). Each is waiting on a client or labour-counsel decision. If a
   task you are doing seems to need one of these, stop and report it rather than inventing a rule.
2. **Do not change the Sunday boundary default.** `midnight_split` stays the default. The entire
   point of D-01 is to make the rule configurable so the choice stops being load-bearing.
3. **Do not apply any migration to the live Supabase project.** Write migrations into
   `supabase/migrations/` and stop there. Applying them is Philip's call, made separately —
   not because the data is real (it is fabricated demo data), but because the live schema has
   diverged from the migrations folder and every push needs checking against it first.
4. **Do not add a minimum rest-gap rule (11-hour or otherwise).** D-09's decision was that the
   current rules are complete. The existing Night→Day / Day→Night conflict checks are not a rest
   gap and must not be relabelled as one.
5. **Preserve existing behaviour** unless a decision explicitly changes it. Where the repo
   conflicts with a decision, implement the decision and document the conflict in your report.
6. No unrelated refactors.

## Order of work — one batch at a time, verified before moving on

### Batch 0 — prerequisites

- **0.1** Add `vitest` and a `test` script. Then write **characterisation** tests for
  `src/lib/payroll-engine.ts` that assert what the engine does *today*, before any change:
  same-day shift; Saturday→Sunday; Sunday→Monday; a shift crossing multiple midnights; exact
  midnight boundary; zero and negative duration; night-band (20:00–07:00) isolation including
  the wrap past midnight; segment minutes summing exactly to shift duration; no minute counted
  twice or lost; weekly ordinary/overtime split against the cap; rostered Sunday at
  `sunday_agreed_multiplier` vs call-in Sunday at `sunday_multiplier`; PAYE annualisation;
  `round2` behaviour such that net === gross − deductions.
  These tests are what make Batches 1 and 2 safe. Get them green before continuing.
- **0.2** The live schema has diverged from the migrations folder. Diff against
  `supabase/schema-baseline-2026-07-05.sql` plus every migration after it, and report any drift
  affecting the tables you are about to touch. `20260807003500` exists because this was missed
  once already.

### Batch 1 — Sunday boundary configuration seam (D-01, D-02)

Add a `sunday_boundary_rule` payroll constant with values `midnight_split` (default) and
`majority_of_shift`. Read it through `src/lib/payroll-data.ts` into `PayrollConstants` and branch
in `bucketiseLogs()` (`src/lib/payroll-engine.ts:282`): midnight-split keeps the existing
per-segment classification; majority-of-shift assigns the whole shift to whichever calendar day
holds more than half its minutes. Per D-02, write **no tie-breaker** — under midnight-split a tie
cannot arise, and the tie case under majority-of-shift goes back to the client. Seed the default
in a migration. Tests for both modes.

### Batch 2 — calculation segment visibility (P-06)

`shiftSegments()` computes per-day segments and `bucketiseLogs()` discards them; only totals
reach `PayslipCalc`. Return a per-shift segment list (date, minutes, night minutes,
classification, multiplier applied) alongside the buckets, persist it with the payroll run, and
render it in the payroll detail and audit trail under the existing per-category breakdown in
`src/routes/_app.payroll.tsx`. **The roster must not change** — one shift stays one stored record
with its real start and end timestamps; segments are a calculation and audit artifact only.

### Batch 3 — manual Sunday base rate (P-01)

Add a per-tenant, per-pay-period, per-employee Sunday base rate that payroll enters manually,
with `entered_by` / `entered_at`. The `run-payroll` edge function
(`supabase/functions/run-payroll/index.ts`) reads it and passes it into `calculateNetPay()`;
where no rate is entered, current behaviour stands. Payroll stays server-authoritative — the
browser must never be the writer of record. Additive migration only.

### Batch 4 — rate validation, warning and acknowledgement (P-02, P-03, P-07, P-08, P-09, P-10, P-11, P-12)

One workflow, all of it:

- Compare the entered Sunday base rate against the employee's calculated ordinary rate.
- If they differ: warn, identify the difference clearly, and **do not block submission on the
  difference alone**.
- Show the warning **both** when the rate is entered **and** again at payroll submission.
- An authorised user must acknowledge the warning before payroll can be submitted. That
  acknowledgement is sufficient — **no additional senior approval step**.
- A reason/comment is **optional**, and recorded when provided.
- The acknowledgement applies to **the current payroll submission only** — not the pay period,
  not until the rate next changes.
- Changing the Sunday base rate **invalidates** any prior acknowledgement and requires a new one.
  Key the acknowledgement to the rate values (stored copy or hash), not just the period.
- If the entered rate **matches** the ordinary rate: record that validation passed and require
  **no** acknowledgement.

Enforce the gate in the database on the finalize/draft-replace path
(`finalize_payroll_period` / `replace_draft_payroll`), not only in the UI — the UI is a mirror,
the database is the enforcement point, consistent with the existing payroll locks. "Authorised
user" reuses the existing role model (`payroll`, with `admin` fallback). Unauthorised users must
not be able to acknowledge on payroll's behalf. Audit the user, timestamp, both rate values, the
validation result acknowledged, and the optional reason.

### Batch 5 — leave capacity cap (D-15)

Both halves, per `UAT_REQUIREMENTS.md` §7:

- A tenant-wide configurable maximum (default 10) employees on annual leave in a calendar month,
  with an effective date and policy owner.
- A per-site, day-level coverage check across each day of the requested range at the employee's
  home site.

Enforce against approved *and* planned annual-leave days at the approval point
(`approve_leave_request`), and show the approver both figures before they decide. Reuse the leave
planner's existing site coverage-risk helper in `src/routes/_app.leave.tsx` and the
`leave_coverage` table rather than re-deriving either.

**Stop at the warning.** What happens when the cap collides with an employee's statutory leave
deadline is D-16 and is still open. Build the check and the display; do not build the resolution,
escalation or override path.

### Batch 6 — verify-and-lock regression tests

Assert existing behaviour so a future change cannot silently undo a deliberate decision:

- **P-04** — a second working shift on the same calendar date is rejected by the database on
  every write path (`20260818230341_roster_assignment_integrity.sql`).
- **D-09** — no minimum rest-gap rule exists; the 60h weekly cap, six-workday rest, and
  Night/Day conflict checks are the complete set.
- **D-19** — an annual-leave balance survives cycle rollover untouched, while sick and
  compassionate lapse (`20260803181750_leave_management_module.sql:337`). **Report this asymmetry
  rather than changing it** — D-19 only ever asked about annual leave.
- **D-03** — a rostered Sunday pays `sunday_agreed_multiplier` (1.5×) and a call-in Sunday pays
  `sunday_multiplier` (2×), with no per-employee consent flag consulted.

## Standards

- Use the project's existing timezone conventions and its decimal-safe money arithmetic. Never
  double-count or lose a minute at a boundary. Never rewrite historical payroll records.
- Migrations additive and backwards-compatible, following the repo's naming convention. Explain
  why each is needed. Never delete historical payroll or roster data.
- Follow existing RLS and role patterns; new tables get RLS with a read/write scope matching the
  nearest comparable table. Check `get_advisors` guidance in `CLAUDE.md` before proposing any
  policy change.
- Run `bun run lint`, `bun run build`, and the new test suite for every batch. **Do not claim an
  item is done because code was written — run the checks and report the actual output.**
- Append an entry to `UPDATES.md` per the convention in `CLAUDE.md` (newest at top, dated and
  timed) as you complete each batch, not at the end.

## Report at the end

1. Files changed, per batch.
2. Migrations added — and confirmation that **none were applied** to the live project.
3. Existing code paths reused rather than duplicated.
4. Each decision ref (D-xx / P-xx) mapped to where it is now implemented and the test that
   covers it.
5. Commands run and their actual output.
6. Any schema drift found in 0.2.
7. Conflicts found between a decision and existing behaviour.
8. Anything you hit that turned out to depend on a blocked decision — named, with what is needed
   to unblock it.
9. What you deliberately did not do.
