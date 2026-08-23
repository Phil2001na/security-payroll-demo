# UAT — payroll, rostering and leave controls

**UAT date:** 2026-08-20  
**Source:** Client UAT transcript  
**Status:** Requirements captured; implementation and formal client sign-off pending.

## Purpose

Confirm that payroll and roster controls protect the company from overwork, unfair premium-shift allocation, avoidable leave liability and undocumented exceptions.

The detailed rationale, client statements and legal decision gates are in [UAT_REQUIREMENTS.md](UAT_REQUIREMENTS.md).

## Items to address

| ID | Area | Required outcome | Priority | Status |
| --- | --- | --- | --- | --- |
| UAT-01 | Sunday pay | Decide and implement the approved rule for shifts that cross midnight into/out of Sunday, with itemised payroll evidence. | Critical | Decision required |
| UAT-02 | Sunday 1.5× | Require recorded employee agreement and equal time off before the 1.5× arrangement can be finalised. | Critical | Not started |
| UAT-03 | Sunday eligibility | Separate normal rostered Sunday work, call-ins/relief work and any other contractual Sunday category. | High | Not started |
| UAT-04 | Rest protection | Block incompatible consecutive shifts and insufficient rest across every schedule-writing path. | Critical | Partially implemented |
| UAT-05 | Hour protection | Hard-block daily/weekly limit breaches; do not present a warning-only bypass. | Critical | Partially implemented |
| UAT-06 | Fair allocation | Rank eligible candidates by lower hours and fewer recent premium/Sunday opportunities. | High | Not started |
| UAT-07 | Premium cap | Enforce the agreed maximum premium/Sunday opportunity per employee per policy window. Initial proposal: one per calendar month. | High | Decision required |
| UAT-08 | No-candidate response | Where no one is compliant, refuse assignment and state the staffing gap and failed eligibility rules. | Critical | Partially implemented |
| UAT-09 | Emergency exceptions | If permitted, use a separate senior-authorised exception workflow with reason and audit trail. | High | Decision required |
| UAT-10 | Shortage register | Record unfilled coverage and aggregate it for Operations/HR recruitment planning. | High | Not started |
| UAT-11 | Leave cycles | Track annual leave per employee’s individual cycle and calculate the latest compliant leave date. | Critical | Partially implemented |
| UAT-12 | Leave planner | Proactively alert Operations to employees due/overdue for leave, including site/coverage risk. | High | Not started |
| UAT-13 | Directed leave evidence | Record employer-offered/instructed leave, employee acknowledgement/refusal, dates, reason and supporting evidence. | High | Not started |
| UAT-14 | Leave capacity | Add configurable leave-cap controls. Client proposal: no more than 10 employees on annual leave per month. | High | Decision required |
| UAT-15 | Leave conflict handling | Show statutory/company deadline risk alongside monthly/site coverage constraints; never silently deny leave. | Critical | Not started |
| UAT-16 | Premium reporting | Give management an employee-level report of Sunday/premium assignments, hours and pay. | Medium | Not started |
| UAT-17 | Recruitment workflow | Decide whether to build only shortage reporting now, or also an applicant pipeline/link for drivers and supervisors. | Low | Decision required |

## UAT test cases

| Test | Steps | Expected result | Result | Notes |
| --- | --- | --- | --- | --- |
| UAT-T01 | Create a Sat 18:00–Sun 06:00 shift; run payroll. | Payroll applies the client-approved Sunday-boundary rule and shows the calculation by time band/rule. | Pending | Depends on UAT-01. |
| UAT-T02 | Create a Sun 18:00–Mon 06:00 shift; run payroll. | Counterpart calculation is correct and itemised. | Pending | Depends on UAT-01. |
| UAT-T03 | Attempt Sunday 1.5× payment without consent or matching time-off record. | Payroll cannot finalise without an approved exception. | Pending | UAT-02. |
| UAT-T04 | Roster a guard for Sunday night, then attempt Sunday day assignment. | System refuses if the rest rule fails and explains why. | Pending | UAT-04. |
| UAT-T05 | Attempt assignment that exceeds the employee’s applicable hour cap. | System refuses the assignment in manual, auto-fill, custom-coverage and relief flows. | Pending | UAT-05. |
| UAT-T06 | Give one guard a premium Sunday, then fill another eligible premium Sunday in the same policy window. | Previously selected guard is excluded; a compliant lower-hours/less-recent candidate is preferred. | Pending | UAT-06/07. |
| UAT-T07 | Make all candidates ineligible for a required shift. | No assignment is created; a shortage record identifies the gap and reasons. | Pending | UAT-08/10. |
| UAT-T08 | View leave planner for employees nearing cycle deadline. | Planner shows deadline, balance, coverage impact and recommended action. | Pending | UAT-11/12. |
| UAT-T09 | Offer/instruct annual leave and record employee refusal. | System retains immutable, exportable acknowledgement/refusal evidence. | Pending | UAT-13. |
| UAT-T10 | Approve annual leave that exceeds the agreed monthly cap or creates deadline risk. | System shows the conflict and follows the approved policy/escalation path. | Pending | UAT-14/15. |

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

