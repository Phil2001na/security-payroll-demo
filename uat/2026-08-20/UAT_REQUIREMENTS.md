# UAT requirements extraction — scheduling, Sunday pay and leave

Source: client UAT transcript supplied 2026-08-20. This is a requirements record, not legal advice. Statements labelled **legal confirmation required** must be checked against the client’s contract/collective agreement and Namibian labour counsel before changing production pay or leave rules.

## The client’s outcome

The system must stop Operations from using the same guards repeatedly for premium shifts or excessive hours. It should allocate scarce work fairly, identify when staffing is genuinely insufficient, and create evidence that the employer actively managed leave and rest obligations.

The client explicitly wants a hard system refusal to be an operational control: if there is no compliant eligible guard, the system must say so rather than allow staff to override it informally. The resulting shortage is evidence for Operations/HR to recruit or arrange coverage.

## Confirmed business requirements

### 1. Sunday-crossing shift calculation

Client example: a Saturday 18:00 to Sunday 06:00 shift.

- Saturday 18:00–24:00: six hours at the normal rate.
- Sunday 00:00–06:00: six hours at the agreed Sunday 1.5× rate.
- Expected pay expression: `6 × normal hourly rate + 6 × 1.5 × hourly rate` (15 base-rate hours of pay).
- The same principle should apply to a Sunday 18:00 to Monday 06:00 shift: Sunday portion receives the Sunday treatment and the Monday portion is normal-rate work.
- The calculation must be visible/auditable on the payslip or payroll detail—not a hidden total.

**Legal decision gate:** section 21(8) of the Labour Act says a shift that begins on or extends into Sunday is treated wholly as Saturday/Monday or Sunday according to where the majority of its hours fall. The UAT asks for a clock-at-midnight split; a 18:00–06:00 shift is a 6/6 tie, which the statutory wording does not resolve. Do not change the existing date-aware calculation until the client obtains a documented interpretation/contractual basis.

### 2. Sunday 1.5× arrangement must be controlled, not assumed

The client’s explanation is that 1.5× is used only where the employee has had an equal amount of rest time during the next working week. They want the system to protect this arrangement because abuse can create a wage and compliance exposure.

Product requirements:

- Store the basis used for every Sunday payment: normal Sunday rate, 1.5× arrangement, or another approved contractual rule.
- For a 1.5× arrangement, capture the employee’s agreement and the matching equal time off in the next working week.
- Prevent payroll finalisation where the supporting rest/consent record is absent or unresolved; an authorised compliance exception requires a reason and audit trail.
- Distinguish a normal rostered Sunday from a last-minute call-in/relief Sunday; do not silently apply the favourable rate to the wrong category.

**Legal confirmation required:** the Act’s default Sunday payment is 2×; its 1.5× alternative requires both equal time away in the next working week and employee agreement. The existing `ordinarily_works_sundays` flag/multiplier should be reviewed against this requirement rather than treated as sufficient by itself.

### 3. Fair allocation of Sunday and premium shifts

The client does not want the same guard repeatedly assigned to the lucrative Sunday 06:00–18:00 shift while others receive none. They described this as an anti-favouritism and cost-control rule.

- Treat Sunday day shifts/premium opportunities as a fairness-controlled allocation pool.
- Default policy requested: a guard receives at most one such opportunity per calendar month.
- The scheduler should prefer eligible guards with fewer total hours and fewer premium/Sunday opportunities, rather than the familiar or previously-used guard.
- Once a guard has received the opportunity, they must be excluded from suggestions for a subsequent Sunday until the policy window resets; the system should show the reason.
- The exact policy window must be configurable because the client noted it may be two or three months when the workforce is large.
- Reporting must show premium/Sunday assignments and premium pay by employee for a selected period, so managers can see an uneven distribution before staff complain.

### 4. Hard scheduling compliance rules

The system must refuse to post an employee when doing so would breach policy. It should not merely warn and let a supervisor continue.

- Never assign a guard who is already over the applicable daily/weekly/rest limit.
- Never assign a guard to an incompatible follow-on shift (for example, a Sunday overnight worker immediately into Sunday 06:00–18:00).
- The eligibility engine must use actual hours, scheduled rest, premium-shift history, approved leave, site qualification and assignment conflicts.
- When filling a shortage, rank suggestions by lowest relevant hours and least recent premium opportunity.
- If no compliant candidate exists, return a clear **no eligible guard** result naming the failed rules and the staffing gap. Do not suggest or auto-assign an over-limit guard.
- Any emergency override, if the client later permits one, must be a separate explicit workflow with senior approval, reason, legal-risk acknowledgement and an audit event—not an ordinary roster edit.

Current implementation already has useful foundations: one work shift per date, 60-hour weekly cap, a weekly rest check, and Night→next-Day / Day→next-Night conflicts. The new work is to make the rule set complete, explainable and fairness-aware across every scheduling path.

### 5. Recruitment signal from shortages

The client recruits continuously through a training institution and expects staffing shortages to expose a recruitment/Operations failure rather than be hidden by overworking guards.

- Maintain a shortage register whenever the scheduler cannot fill required coverage with compliant guards.
- Record site, date/shift, required headcount, unmet headcount, failed eligibility reasons and who attempted allocation.
- Provide a weekly Operations/HR report that groups recurring shortages by site/shift/required skills.
- Recruitment is currently an offline pipeline: training institution referral → CV/pre-screen → detailed/OR interview → physical suitability test → select only qualifying candidates. No applicant portal was explicitly requested for guards.
- A future driver/supervisor recruitment link or application workflow was mentioned, but is not yet a defined requirement.

### 6. Proactive annual-leave management

The client wants the system to help Operations prevent leave liabilities and fatigue, not just record requests.

- Every employee needs an individual annual leave cycle anchored to their employment start/cycle date.
- Surface an actionable leave-planning window as the cycle approaches its statutory/company deadline.
- Produce a proactive list: employees due/overdue for leave, entitlement/balance, cycle end, latest compliant leave date, sites affected, and available coverage risk.
- Provide suggested leave candidates/months; manager approval remains human.
- Keep a clear distinction between: employee requested leave, employer instructed/scheduled leave, approved leave, employee refused leave, employer postponed/declined leave, and expired/forfeited leave.
- For an employer-directed leave offer/instruction, capture the employee acknowledgement. If refused, capture the refusal, employee acknowledgement/signature (or documented refusal to sign), reason, dates offered and witnesses/attachments where relevant.
- Retain this evidence with the leave ledger and make it exportable for a labour dispute.
- Do not automatically forfeit, cash out or expire annual leave solely from a scheduler date. It requires an explicit policy/legal decision and evidence that the employer properly offered/instructed leave.

### 7. Leave capacity policy

The client stated a business policy that a maximum of 10 employees should be on annual leave in a month.

- Make the limit configurable by tenant, with an effective date and policy owner.
- Enforce it against approved/planned annual-leave days, while presenting impact by day, site and required role—not only a monthly headline total.
- A simple monthly cap must not automatically defeat statutory leave timing; instead, flag the conflict early and require a documented management decision/alternative date.
- Show the approver both the employee’s deadline risk and the relevant coverage impact before a decision.

## Important clarification of the leave discussion

The transcript sometimes describes a "three-month window" around an anniversary. The statutory text reviewed does **not** say that leave may only be taken in those three months. It provides a 12-month annual leave cycle, then requires the employer to determine a leave time no later than four months after the cycle ends (or six months only if the employee agreed in writing before the four-month period expires). The product should therefore model the statutory deadline and any client planning window separately. [Namibia Labour Act, 2007, s.23](https://namiblii.org/akn/na/act/2007/11/eng%402023-03-15)

The transcript’s practical concern is valid: if the employer repeatedly refuses or fails to arrange leave, the employer carries the exposure. However, whether and when unused leave can lapse, or must be paid, is fact- and agreement-dependent. The Act prohibits payment in substitution for annual leave except on termination; do not encode automatic cash payments or forfeiture without labour-law review.

## Decisions required from the client before implementation

1. **Sunday boundary rule:** follow the client’s midnight split, the Act’s majority-of-shift rule, or a documented contractual/collective-agreement interpretation for tied shifts.
2. **Sunday 1.5× eligibility:** confirm the exact employee-consent process and how equal time off is measured, scheduled and proven.
3. **Premium opportunity definition:** does it include only Sunday 06:00–18:00, every Sunday-working shift, public holidays, relief/call-ins, or another set?
4. **Fairness policy:** one opportunity per calendar month is the stated starting point; confirm the configurable windows, whether it is a hard block, and who may authorise an emergency exception.
5. **Hours/rest limits:** confirm any stricter client/contract rules beyond the existing 60-hour weekly and six-workday controls.
6. **Leave planning:** confirm whether the "maximum 10" is tenant-wide, site-specific or both; whether it applies to people or leave-days; and how statutory deadline conflicts are escalated.
7. **Leave refusal evidence:** confirm acceptable signature method, witness requirements and document-retention policy.
8. **Recruitment scope:** decide whether shortage reporting is enough for phase one, or whether HR also needs a candidate pipeline/application link.

## Priority order

1. Validate Sunday-pay legal interpretation and encode/test the chosen rule.
2. Make scheduler hard-blocks and eligible-candidate explanations reliable across manual, auto-fill, custom coverage and relief workflows.
3. Add premium/Sunday fairness allocation and reporting.
4. Add leave-deadline dashboard, directed-leave/refusal evidence and the 10-person capacity policy.
5. Add the shortage-to-recruitment report; consider applicant pipeline later.

## UAT acceptance tests

- A Sat 18:00–Sun 06:00 shift produces the agreed, itemised pay treatment and a Sunday-pay audit record.
- A Sunday 18:00–Mon 06:00 shift produces the agreed counterpart treatment.
- A guard who worked Sunday night cannot be assigned Sunday day if the rest rule fails.
- A guard who has already received the monthly premium opportunity is not suggested for another eligible premium shift; a lower-hours eligible guard is suggested instead.
- When everyone is ineligible, all scheduling entry points refuse the assignment and create/show a shortage record.
- A 1.5× Sunday record cannot finalise without the required consent/time-off evidence, unless an explicitly authorised exception is recorded.
- An employee nearing their annual-leave deadline appears on the leave planner early enough to schedule coverage.
- A manager can record an offered/instructed leave period and an employee refusal with immutable evidence.
- The 10-person monthly leave threshold warns/blocks according to the agreed policy while showing deadline and site-coverage implications.

