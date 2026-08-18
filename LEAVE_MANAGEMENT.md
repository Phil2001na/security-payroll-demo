# Leave management module

## Operating model

Leave is a two-person workflow: a supervisor or manager submits on behalf of a guard, then
Admin, Operations or Payroll approves or rejects it. The requester cannot approve their own
submission. The disciplinary three-person chain is intentionally not reused because leave is
not punitive. Coverage confirmation and payroll validation are downstream controls, not second
and third approval signatures; Payroll/HR intervenes only for exceptions.

The unit of leave is a **scheduled working date**, not Monday–Saturday and not every calendar
date in the requested range. This matters for guards on irregular day/night rosters. An approved
request charges one day for each date on which the guard had one or more working assignments;
ordinary off-days inside the range cost nothing.

## Lifecycle

1. **Submit** — employee, type, dates, reason and optional evidence are recorded. Overlapping
   active requests are refused. Field supervisors may submit only for guards at their assigned
   sites.
2. **Review** — the system shows projected scheduled days, available balance, evidence rules,
   affected sites/shifts and resulting coverage gaps.
3. **Approve/reject** — approval is atomic: policy and balance are checked, scheduled work is
   changed to the matching leave shift, the immutable ledger records usage, and each vacated
   site shift becomes an open coverage requirement. Rejection requires a reason.
4. **Cover** — Operations assigns an eligible active guard. The replacement cannot already be
   rostered or on approved leave that date. The replacement assignment is flagged as a call-in,
   preserving the Sunday 2× rule.
5. **Payroll** — paid leave contributes the original rostered hours multiplied by the policy's
   paid percentage. Unpaid leave contributes zero. Finalized-period accruals are mirrored into
   the same immutable ledger.
6. **Cancel** — approved leave can be reversed only while payroll is open and before replacement
   attendance exists. The original assignments and balance are restored in one transaction.

## Data model

- `leave_policies`: tenant policy per annual/sick/compassionate/maternity/unpaid type.
- `leave_requests`: workflow header and decision audit.
- `leave_request_days`: materialized dates, scheduled-day charge and paid hours.
- `leave_cycles`: annual, 36-month sick and 12-month compassionate entitlement windows.
- `leave_coverage`: every vacated site shift and its replacement assignment.
- `leave_ledger`: immutable entitlement, accrual, usage, reversal, adjustment and expiry entries.
- `leave_balances`: retained as the fast current-balance projection used by existing screens.

## Policy controls

Each leave type controls notice, evidence threshold, maximum consecutive charged days and active
state. Balance enforcement/negative-balance controls apply to annual, sick and compassionate leave.
Their statutory days remain 100% paid; unpaid leave is fixed at 0%. Maternity has no day balance and
is the one policy whose employer-funded percentage can be configured from 0–100% to reflect a
contractual top-up while preserving the Social Security benefit distinction.

## Security and audit

All tables use tenant RLS. Direct writes are not granted to the browser; state changes go through
role-checked RPCs. Public execution is revoked from every privileged function. Requests, ledger
entries and coverage changes feed the existing audit-event system. Employee/site/date foreign keys
used for roster, approval and payroll queries are indexed.

## Edge cases handled

- off-days and non-working dates inside a request do not consume leave;
- multiple shifts on one date consume one leave day but create one cover requirement per shift;
- overlapping submitted/approved requests are refused under an employee-scoped transaction lock;
- requests overlapping locked payroll cannot be approved or cancelled;
- sick and compassionate leave may be recorded retrospectively despite planned-leave notice rules;
- insufficient annual balance blocks approval unless policy permits a negative balance;
- evidence thresholds are applied to charged working days;
- a guard cannot be rostered for work on an approved leave date;
- the absent guard cannot cover their own shift;
- cancellation is refused after cover attendance is logged;
- accrual and usage entries are idempotent through partial unique indexes.
- migrated sick/compassionate opening balances are credited against the first statutory-cycle grant;
- a confirmed leaver accrues annual leave only through the recorded last working day;
- ledger rows cannot be edited or deleted; corrections require a reversing or adjustment row.

## Deployment and verification

The migration is local only until reviewed against a disposable Supabase project. `npm run verify:leave`
already executes it in isolated PostgreSQL and covers the core RPC/RLS/roster/payroll chain documented
in `LEAVE_VERIFICATION.md`. Before deployment, run the remaining Supabase Storage, multi-session
concurrency and browser checks in `LEAVE_UAT.md`; run database advisors and regenerate
`src/integrations/supabase/types.ts` against that deployed schema.

## Completed implementation additions

- Approval now waits for a published working roster, so an approved request cannot silently produce zero pay and zero balance usage.
- Paid percentages and all five leave types are persisted in payroll; payslips separate ordinary worked, annual, sick, compassionate, maternity and unpaid hours.
- Replacement assignment enforces the 60-hour weekly ceiling unless the guard has an active PS exemption, in addition to existing roster controls.
- Private evidence upload uses tenant and role/site-scoped storage access and short-lived signed links.
- The UI includes roster-impact preview, coverage waiver with reason, employee history, an immutable-ledger report and CSV export.
- The executable deployment/UAT handoff is `LEAVE_UAT.md`.

## Namibian statutory floor

The module treats the Labour Act as a minimum while allowing more favourable employer policies:

- annual leave accrues proportionally toward four ordinary work weeks per 12-month cycle, independent of legitimate absences;
- sick leave is cycle-backed: 30 working days for a five-day week, 36 for six days and pro rata otherwise over 36 months; year one earns one day per 26 worked days;
- medical evidence defaults to the third consecutive charged working day;
- compassionate leave grants five paid working days per 12-month cycle and expires at cycle end;
- maternity is separate, checks six months of continuous service and a minimum 12-week request, and reserves the statutory absence; employer-funded pay defaults to zero because benefits or employer top-ups must match the actual arrangement;
- workflow, cycle, usage and payroll records are not automatically deleted, supporting the five-year employment-record requirement.

Policy changes must not reduce these floors. Confirm any collective agreement or more favourable employment contract before deployment.

Primary references used for the statutory floor:

- [Namibia Labour Act 11 of 2007 (current consolidated text)](https://namiblii.org/akn/na/act/2007/11/eng%402023-03-15)
- [Ministry of Labour Labour Act PDF](https://mol.gov.na/documents/53329/69965/Labour%2BAct%2B%28No%2B11%2Bof%2B2007%29.pdf/d04e1090-103e-a978-89c2-bbdbcc32fa8f)
- [Labour General Regulations, 2008](https://namiblii.org/akn/na/act/gn/2008/261/eng%402017-11-15)
