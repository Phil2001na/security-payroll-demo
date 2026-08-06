# Leave management UAT

Run this matrix in a disposable Supabase environment after applying all migrations in timestamp order. Do not run it against locked historical payroll without a backup.

First run `npm run verify:leave`. Its isolated PostgreSQL integration automates the core database cases listed in `LEAVE_VERIFICATION.md`; this matrix remains the deployment gate for Supabase Storage, real multi-session concurrency and rendered role/browser behavior.

## Test identities and data

- Admin, Operations, Payroll, Supervisor and Security Supervisor accounts;
- two guards at the Security Supervisor's assigned site and one guard outside it;
- one guard with at least 5 annual-leave days;
- a published roster containing weekday, Sunday, day and night assignments;
- one open pay period covering the test dates and one locked historical period;
- one active PS exemption and one non-exempt guard close to 60 weekly hours.

## Submission and access

| ID  | Test                                                            | Expected result                                                     |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| L01 | Supervisor submits annual leave with employee, dates and reason | Status is `submitted`; one request-day row exists per calendar date |
| L02 | Security Supervisor submits for a guard at an assigned site     | Accepted                                                            |
| L03 | Security Supervisor submits outside assigned sites              | Rejected; no request created                                        |
| L04 | Submit an overlapping request for the same guard                | Rejected, including simultaneous submissions                        |
| L05 | Upload a PDF/image as evidence                                  | Stored privately; authorized user opens a short-lived signed URL    |
| L06 | Read another tenant's request, ledger, coverage or evidence     | No access                                                           |

## Approval, balances and roster

| ID  | Test                                             | Expected result                                                                 |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| L07 | Requester approves their own request             | Rejected                                                                        |
| L08 | Different Admin/Operations/Payroll user approves | Approved with decision identity/time                                            |
| L09 | Approve before working roster exists             | Rejected with publish-roster guidance; remains submitted                        |
| L10 | Approve range containing work and off dates      | Only distinct working dates charged                                             |
| L11 | Approve a date with two rostered shifts          | One leave day; two coverage rows; correctly valued logs                         |
| L12 | Annual leave with insufficient balance           | Rejected unless policy permits negative balance                                 |
| L13 | Sick/compassionate request in an active cycle    | Statutory entitlement exists, usage deducts it and cycle dates remain auditable |
| L14 | Evidence-required leave without evidence         | Atomic rejection; roster/balance/coverage unchanged                             |
| L15 | Roster normal work on approved leave date        | Database rejects assignment                                                     |

## Coverage

| ID  | Test                                                               | Expected result                                          |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| L16 | Assign active available replacement                                | `is_replacement=true`; coverage `assigned`               |
| L17 | Assign absent guard, busy/on-leave guard, or non-exempt >60h guard | Rejected                                                 |
| L18 | Assign >60h guard with active PS exemption                         | Accepted, subject to other roster controls               |
| L19 | Waive without/with reason                                          | Without reason rejected; with reason audited as `waived` |
| L20 | Unassign after replacement attendance                              | Rejected                                                 |

## Payroll and cancellation

| ID  | Test                                                                    | Expected result                                                                                     |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| L21 | Run payroll for annual, sick, compassionate, maternity and unpaid leave | Separate hours persist; policy percentage is honored; maternity/unpaid default to zero employer pay |
| L22 | Generate and reopen payslip                                             | Worked and leave lines are separate and reconcile to gross                                          |
| L23 | Transport with approved leave                                           | Original roster day remains denominator; leave is not attendance                                    |
| L24 | Create open period after leave approval                                 | One correctly valued log per assignment; no multi-shift duplication                                 |
| L25 | Cancel before cover attendance                                          | Original shifts/balance restored; leave logs/replacements removed                                   |
| L26 | Cancel in locked payroll or after cover attendance                      | Rejected atomically                                                                                 |

## Reporting and audit

| ID  | Test                               | Expected result                                                                                 |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| L27 | Open employee profile              | Balances and recent requests agree with leave page                                              |
| L28 | Export leave ledger CSV            | UI and CSV rows agree with accrual/usage/reversal/adjustment data                               |
| L29 | Inspect audit events               | Decisions, ledger, coverage and attendance transitions attributable                             |
| L30 | Concurrent approval/cover attempts | No double deduction or double assignment                                                        |
| L31 | First-year sick cycle              | One day is earned per 26 approved worked days; the statutory cycle floor applies after year one |
| L32 | Sick/compassionate cycle rollover  | Unused balance expires with a ledger row and the new entitlement is granted once                |
| L33 | Maternity before/after six months  | Before threshold rejected; after threshold follows roster and coverage flow                     |
| L34 | Maternity request shorter/at 12 weeks | Shorter request rejected; 84 consecutive calendar days accepted                              |
| L35 | Configure maternity to 50% employer pay | Scheduled and paid maternity hours persist separately; payslip and gross reconcile          |
| L36 | Attempt partial pay on annual/sick/compassionate or paid unpaid leave | Rejected as below the statutory paid-leave floor or inconsistent with unpaid leave |
| L37 | First cycle with an existing migrated sick/compassionate balance | Opening balance is credited against the entitlement; it is not granted twice       |
| L38 | Final payroll for a confirmed leaver | Annual accrual stops on the recorded last working day                                           |
| L39 | Update or delete a leave-ledger row directly | Database rejects it; a reversal or adjustment entry is required                             |

## Reconciliation

Confirm each enforced balance reconciles to ledger entries, every approved working assignment has exactly one leave log in its open pay period, and every non-cancelled vacated shift has one coverage row. The normal workflow requires one independent approver; coverage assignment and payroll validation are controls, not extra leave approvals. Run database advisors and regenerate TypeScript types before deployment.
