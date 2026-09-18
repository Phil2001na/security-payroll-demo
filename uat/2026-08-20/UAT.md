# UAT — payroll, rostering and leave controls

**UAT date:** 2026-08-20  
**Source:** Client UAT transcript  
**Status:** Requirements captured; implementation partially complete; formal client sign-off pending.
**Status column last verified against the code:** 2026-09-17.

## Purpose

Confirm that payroll and roster controls protect the company from overwork, unfair premium-shift allocation, avoidable leave liability and undocumented exceptions.

The detailed rationale, client statements and legal decision gates are in [UAT_REQUIREMENTS.md](UAT_REQUIREMENTS.md).

## Items to address

| ID | Area | Required outcome | Priority | Status |
| --- | --- | --- | --- | --- |
| UAT-01 | Sunday pay | Decide and implement the approved rule for shifts that cross midnight into/out of Sunday, with itemised payroll evidence. | Critical | Built - `midnight_split` default (D-01), selectable in Admin settings |
| UAT-02 | Sunday 1.5× | Require recorded employee agreement and equal time off before the 1.5× arrangement can be finalised. | Critical | Closed by decision 2026-09-03 - blanket 1.5x kept, exposure recorded |
| UAT-03 | Sunday eligibility | Separate normal rostered Sunday work, call-ins/relief work and any other contractual Sunday category. | High | Built - rostered / call-in / public holiday separated; no further contractual category modelled |
| UAT-04 | Rest protection | Block incompatible consecutive shifts and insufficient rest across every schedule-writing path. | Critical | Partially implemented |
| UAT-05 | Hour protection | Hard-block daily/weekly limit breaches; do not present a warning-only bypass. | Critical | **Built 2026-09-17.** Daily 12h is a CHECK, weekly 60h and rest are in the integrity trigger, monthly is `enforce_monthly_hour_cap` on both `schedule_assignments` and `shift_logs`. All now route past the UAT-09 admin override instead of the blanket tenant switch. **Dormant where `monthly_cap_enforced = 0`** — Apex Shield is 1, the other four tenants are 0. Philip flips it per tenant. |
| UAT-06 | Fair allocation | Rank eligible candidates by lower hours and fewer recent premium/Sunday opportunities. | High | Built - ranking signal from 90-day premium history |
| UAT-07 | Premium cap | Enforce the agreed maximum premium/Sunday opportunity per employee per policy window. Initial proposal: one per calendar month. | High | Decided 2026-09-03 (one per month, configurable; exclude from suggestions) - not built |
| UAT-08 | No-candidate response | Where no one is compliant, refuse assignment and state the staffing gap and failed eligibility rules. | Critical | **Built 2026-09-17.** All four write paths (manual, auto-fill, generate, custom coverage) go through `placeAssignments`: the refusal names every failed rule, refused shifts are listed per guard instead of aborting the batch, and a `schedule_shortages` row is written for each refused slot. |
| UAT-09 | Emergency exceptions | If permitted, use a separate senior-authorised exception workflow with reason and audit trail. | High | **Built 2026-09-17.** `roster_emergency_overrides` live: admin-only, mandatory 20-char reason, mandatory legal-risk acknowledgement, single use, its own audit event, post-hoc verify/confirm by two other people. Structural rules stay non-overridable. Offered in the scheduler on the refused shifts. |
| UAT-10 | Shortage register | Record unfilled coverage and aggregate it for Operations/HR recruitment planning. | High | **Built 2026-09-17.** `report_weekly_shortages(p_weeks)` RPC (SECURITY INVOKER, so the existing shortage RLS applies) plus a Recruitment card on the Schedule page: gaps grouped by site, shift and the site's required guard grade, flagged recurring at two or more separate weeks, with CSV export. |
| UAT-11 | Leave cycles | Track annual leave per employee’s individual cycle and calculate the latest compliant leave date. | Critical | Built - `latest_leave_date` deadline surfaced in the leave planner |
| UAT-12 | Leave planner | Proactively alert Operations to employees due/overdue for leave, including site/coverage risk. | High | Built - due/overdue planner with site coverage risk |
| UAT-13 | Directed leave evidence | Record employer-offered/instructed leave, employee acknowledgement/refusal, dates, reason and supporting evidence. | High | **Built 2026-09-17.** `directed_leave_records` live: who offered, dates, reason, response (acknowledged / refused / refused-to-sign), typed acknowledgement, optional witness, attachments in the existing `leave-evidence` bucket, recording user and timestamp. Append-only by trigger. New Leave > Directed leave tab with CSV export. No signature UI. |
| UAT-14 | Leave capacity | Add configurable leave-cap controls. Client proposal: no more than 10 employees on annual leave per month. | High | **Built 2026-09-17.** `annual_leave_capacity_policies` + `preview_annual_leave_capacity` live; admin cap editor on Leave > Policies; approver sees monthly and per-site figures and must give a reason to approve past a warning. Warn only. |
| UAT-15 | Leave conflict handling | Show statutory/company deadline risk alongside monthly/site coverage constraints; never silently deny leave. | Critical | **Built 2026-09-17.** Approval dialog shows the s.23 deadline beside the capacity figures, names a cap-vs-deadline collision without resolving it (D-16 stays out of scope), and warns when *rejecting* leave that is against the clock. Warn only. |
| UAT-16 | Premium reporting | Give management an employee-level report of Sunday/premium assignments, hours and pay. | Medium | Built - Sunday & premium report with CSV export on the Payroll page |
| UAT-17 | Recruitment workflow | Decide whether to build only shortage reporting now, or also an applicant pipeline/link for drivers and supervisors. | Low | Closed by decision 2026-09-03 - shortage reporting only |

## UAT test cases

| Test | Steps | Expected result | Result | Notes |
| --- | --- | --- | --- | --- |
| UAT-T01 | Create a Sat 18:00–Sun 06:00 shift; run payroll. | Payroll applies the client-approved Sunday-boundary rule and shows the calculation by time band/rule. | Pending | Depends on UAT-01. |
| UAT-T02 | Create a Sun 18:00–Mon 06:00 shift; run payroll. | Counterpart calculation is correct and itemised. | Pending | Depends on UAT-01. |
| UAT-T03 | Attempt Sunday 1.5× payment without consent or matching time-off record. | Payroll cannot finalise without an approved exception. | Pending | UAT-02. |
| UAT-T04 | Roster a guard for Sunday night, then attempt Sunday day assignment. | System refuses if the rest rule fails and explains why. | **Pass (2026-09-17)** | UAT-04. Run by `scripts/verify-roster-overrides.ts` as the regression guard for the UAT-09 trigger rewrite: a Day shift after a Night shift is refused naming "rest between shifts (Night shift the day before)", and a second working shift on the same day is refused naming the duplicate. Does not by itself close UAT-04, which Philip is handling separately. |
| UAT-T05 | Attempt assignment that exceeds the employee’s applicable hour cap. | System refuses the assignment in manual, auto-fill, custom-coverage and relief flows. | **Pass (2026-09-17)** | UAT-05. Run by `scripts/verify-monthly-hour-cap.ts` with enforcement enabled inside a rolled-back transaction: the write is refused on `schedule_assignments` AND `shift_logs`, a wrong-rule override does not help, a `monthly_hours` override does and is consumed. All four client flows share one `placeAssignments` path (UAT-08), so refusal reaches every one of them. Caveat: the four flows are proven to share the path by construction, not by a browser run. Browser-confirmed 2026-09-17: rostering a 7th consecutive 12h day was refused by the live trigger through the normal Save roster path, and the admin override then authorised and saved it. |
| UAT-T06 | Give one guard a premium Sunday, then fill another eligible premium Sunday in the same policy window. | Previously selected guard is excluded; a compliant lower-hours/less-recent candidate is preferred. | Pending | UAT-06/07. |
| UAT-T07 | Make all candidates ineligible for a required shift. | No assignment is created; a shortage record identifies the gap and reasons. | **Pass (2026-09-17)** | UAT-08/10. Register half by `scripts/verify-roster-overrides.ts`: two guards refused for the same slot leave 0 assignments, group into one gap of two, and the register row stores both refusal reasons. Report half by `scripts/verify-shortage-report.ts`: the same gaps group by site/shift/required grade, three separate weeks flag as recurring while a single week does not, and another tenant sees none of it. Browser-confirmed 2026-09-17 via the demo sign-in: a real DB refusal produced "1 shift refused — the rest were saved", the refusal panel named both broken rules, and the recruitment report rendered the resulting gap grouped by site/shift/grade with Export enabled. |
| UAT-T08 | View leave planner for employees nearing cycle deadline. | Planner shows deadline, balance, coverage impact and recommended action. | Pending | UAT-11/12. |
| UAT-T09 | Offer/instruct annual leave and record employee refusal. | System retains immutable, exportable acknowledgement/refusal evidence. | **Pass (2026-09-17)** | UAT-13. Run by `scripts/verify-directed-leave.ts`: a refusal-to-sign is recorded without a signature, retains offerer/dates/reason/witness/note/attachments, and both UPDATE and DELETE are refused by the append-only trigger even running as the table owner. Export columns verified reachable in one join. Browser-confirmed 2026-09-17: a record was created from the Directed leave tab, the typed-acknowledgement field correctly gated the Record button until filled, and removing the row afterwards required disabling triggers — the append-only guard holds against the UI.
| UAT-T10 | Approve annual leave that exceeds the agreed monthly cap or creates deadline risk. | System shows the conflict and follows the approved policy/escalation path. | **Pass (2026-09-17)** | UAT-14/15. Run by `scripts/verify-leave-capacity.ts` against live: a request breaching the cap on a guard with an 18-day statutory deadline produces 2 capacity warnings, an `approaching` deadline risk, and a reported conflict; the approval then succeeds, proving warn-only. Browser-confirmed 2026-09-17 via the demo sign-in: the capacity cap saved from the Policies tab and read back as "Currently capped at 3 per month", exercising the grants, the admin-only insert policy and the audit trigger. |

## Client/legal decisions required before build

1. Approve the Sunday-crossing rule: client-requested midnight split, majority-of-shift interpretation, or a documented contractual rule for tied shifts.
2. Confirm how employee consent and equal time off are captured for the 1.5× Sunday arrangement.
3. Define premium opportunity precisely and approve the fairness window/cap.
4. Confirm any stricter company/contract limits beyond the current 60-hour weekly policy.
5. Confirm whether the 10-employee annual-leave limit is tenant-wide, site-specific, or both—and whether it counts people or leave-days.
6. Approve the evidence standard for instructed leave and employee refusal.
7. Confirm emergency-exception authority and whether the system may ever allow it.

## Sign-off

| Role | Name | Sign-off | Date | Notes |
| --- | --- | --- | --- | --- |
| Client Operations |  | Pending |  |  |
| Client HR/Payroll |  | Pending |  |  |
| Legal/Compliance |  | Pending |  | Required for Sunday and leave-policy decisions. |
| Product/Engineering |  | Pending |  |  |

