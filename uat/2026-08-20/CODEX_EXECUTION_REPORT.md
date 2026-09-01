# CODEX UAT execution report

**Date:** 2026-08-30  
**Status:** Partial implementation; not ready to apply or deploy.  
**Production database:** No migration was applied and no production data was changed.

## Completed and locally verified

### Batch 0 — test prerequisite

- Added `vitest` and the `bun run test` script.
- Added `src/lib/payroll-engine.test.ts` with 13 tests covering shift boundaries, Sunday crossing, multi-midnight time, night-band time, weekly ordinary/overtime split, Sunday rostered/call-in multipliers, PAYE annualisation, and rounding integrity.
- `bun run test` passed: 1 file, 13 tests.

### Batches 1–2 — Sunday boundary and audit segments

- Added `PayrollConstants.sunday_boundary_rule`, defaulting to `midnight_split`.
- Added the `majority_of_shift` calculation path. A tied majority throws an explicit error requiring client direction; no tie-breaker was invented.
- Added per-shift calculation segments (`date`, minutes, night minutes, classification, multiplier) to the engine, payroll-run payload, persisted `payroll_runs.calculation_segments`, and the Payroll page audit-trail display.
- Added draft migration `supabase/migrations/20260830180000_sunday_boundary_and_payroll_segments.sql`.
- `bun run test` and `bun run build` passed after these changes.

## Draft-only / incomplete work

### Batches 3–4 — manual Sunday rates and acknowledgement

- Draft migration `supabase/migrations/20260830183000_sunday_rate_validation_acknowledgement.sql` creates server-owned rate and acknowledgement tables, restrictive read-only RLS, and a database lock-transition acknowledgement gate.
- This stream is incomplete: the Edge Function does not yet provide a validated rate-entry/acknowledgement action, the Payroll UI has no entry/warning/acknowledgement workflow, and the payroll engine is not yet supplied with stored manual rates.
- Do not apply this migration independently until the incomplete application wiring and migration review are finished.

### Batch 5 — leave capacity

- Draft migration `supabase/migrations/20260830184500_leave_capacity_policy.sql` creates a tenant policy table and a preview helper for approved/planned annual leave by day, site and month.
- This stream is incomplete: `approve_leave_request` is not yet integrated with the preview/check, and the Leave UI does not yet show the assessment before approval.
- The migration intentionally contains no deadline-conflict resolution, escalation, override, expiry, or forfeiture path.

## Verification

| Command | Result |
| --- | --- |
| `bun run test` | Passed — 13 tests |
| `bun run build` | Passed after Batches 1–2; Vite reported existing large-chunk warnings |
| `bun run lint` | Failed repository-wide on pre-existing Prettier CRLF violations and unrelated `any` errors in untouched files |

## Schema drift audit

The repository was assessed from `supabase/schema-baseline-2026-07-05.sql` plus all later migrations, as required. Relevant known divergence is documented in `CLAUDE.md`: the baseline is the July live-schema snapshot, and `20260807003500_fix_missing_leave_cover_helper_functions.sql` exists because helper functions were absent from the migration history. The proposed migrations are additive and do not reuse existing table names.

## Explicitly not implemented

- Premium-cap hard block or override workflow (D-08).
- Comp-rest/equal-time-off model or consent-only fallback (D-04).
- Annual-leave expiry, forfeiture, expired balance, or cash-out (P-13/P-14).
- Any minimum rest-gap rule (D-09).
- Production Supabase migration application, schema write, deployment, or restart.

## Remaining work before acceptance

1. Finish Edge Function actions for rate entry, read-back and acknowledgement, with role validation.
2. Wire the Payroll UI warnings at entry and submission, optional reason, acknowledgement, and rate-change invalidation.
3. Pass manual Sunday rates to `calculateNetPay()` and test persistence/finalization end-to-end.
4. Integrate annual-leave capacity preview/check into `approve_leave_request` and the Leave approver UI, reusing `leave_coverage`.
5. Add database-level regression tests for P-04, D-09 and D-19; add D-03 engine regression coverage (the multiplier part is covered).
6. Run a migration review and test the new migrations in a non-production Supabase environment before any live application.
