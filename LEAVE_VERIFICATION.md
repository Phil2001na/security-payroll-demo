# Leave verification status

## Automated and passing

Run `npm run verify:leave`. It executes all three layers below from an empty process:

1. **Payroll engine** — annual/sick/compassionate full pay, configurable partial maternity
   employer pay, zero-pay unpaid leave, attendance counting, transport proration and gross/net
   reconciliation. An optional `LEAVE_PAYSLIP_OUTPUT` path also emits the exact test payslip for
   PDF rendering and inspection.
2. **Migration invariants** — RLS coverage, role/revocation rules, statutory policy floors,
   locked-period guards, roster/coverage controls, ledger immutability and audit triggers.
3. **Real PostgreSQL integration** — an isolated in-memory PGlite database builds a minimal
   Supabase-compatible baseline, executes the complete leave migration and exercises its DDL,
   PL/pgSQL functions, triggers and RLS.

The database integration currently proves:

- migrated sick/compassionate opening balances are not double-granted;
- field-supervisor site scope, cross-tenant RLS isolation and private evidence-object tenant/site RLS;
- requester/approver separation and direct-write denial;
- overlapping-request and no-published-roster rejection;
- one charged day for two shifts, with two leave logs and two coverage requirements;
- balance usage, relief assignment, cancellation restoration and reversal ledger entry;
- evidence-required approval is atomic and leaves roster/balance/coverage unchanged;
- the 60-hour relief cap, PS exemption path and attendance lock on relief removal;
- statutory paid-percent restrictions and 12-week/six-month maternity gates;
- immutable ledger enforcement;
- payroll breakdown persistence, exact annual accrual, ledger mirroring and period locking;
- refusal to approve/cancel leave in locked payroll.
- a rendered one-page A4 payslip with separate worked, annual, sick, compassionate, paid/unpaid
  maternity and unpaid-leave lines that reconcile gross and net without clipping or broken glyphs.

The integration run found and now guards two defects that static parsing could not detect: cancellation
originally restored shifts before changing the request out of `approved`, and the payroll finalizer had
an ambiguous PL/pgSQL loop-variable/query-alias collision.

## Still requires a disposable Supabase/browser pass

These checks depend on Supabase Storage, separate concurrent sessions or rendered browser/PDF behavior
and therefore remain in `LEAVE_UAT.md`:

- actual Supabase Storage upload plus signed-link generation and expiry;
- browser visibility/actions for every role and site assignment;
- simultaneous approval and relief-assignment races from separate sessions;
- rendered browser behavior for roster preview, employee history and CSV export;
- database advisors and regenerated types against the actual deployed schema.

No remote database has been changed. Apply the migration to a disposable Supabase environment before
running those checks or deploying it to the shared project.
