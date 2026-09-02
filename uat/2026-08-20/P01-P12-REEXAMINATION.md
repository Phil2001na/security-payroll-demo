# P-01 → P-12 — re-examination before closing

**Written:** 2026-09-03, at Philip's request, before the removal of 2026-09-01 is confirmed.
**Question:** was removing the manual Sunday base rate and its validation/acknowledgement
workflow the right call, or did it discard real decisions?

These were nine decisions Philip actually made. They deserve a reason on the record, not a
one-line dismissal in a changelog.

---

## 1. What P-01 → P-12 specified

A single coherent feature, in Keeper's own suggested order of work as batch 3:

| Ref | Specified |
| --- | --- |
| P-01 | For an employee **on a fixed monthly salary**, payroll enters the Sunday base rate **manually each pay period** — not salary ÷ ordinary monthly hours, not a configurable divisor. |
| P-02 | Validate that entered rate against the employee's calculated ordinary rate; **warn** when they differ. Do not block on the difference alone. |
| P-03 | Where the warning fires, an **authorised user must acknowledge** before payroll can be submitted. Log user, timestamp, values, validation result. |
| P-07 | Show the warning **twice** — at entry, and again at submission. |
| P-08 | The acknowledgement covers **the current submission only**. |
| P-09 | A reason on the acknowledgement is **optional**, recorded when given. |
| P-10 | Changing the rate **invalidates** the acknowledgement; key it to the values, not the period. |
| P-11 | A matching rate records **validation passed**, requires no acknowledgement. |
| P-12 | The acknowledgement is **sufficient** — no second senior approval. |

As a workflow this is well-formed. The scoping is careful, the re-acknowledgement rule in P-10
is the kind of detail that only comes from thinking properly about the failure mode, and P-12
deliberately resists gold-plating. Nothing here is careless.

## 2. The conflict with the engine

`src/lib/payroll-engine.ts:483`:

```ts
const isManagement =
  employee.category === "management" && Number(employee.monthly_salary || 0) > 0;
```

For anyone matching that test, the engine bypasses `bucketiseLogs()` entirely — every hour
bucket is zeroed — and then, at lines 536–547:

```ts
const sunday_amount        = isManagement ? 0 : ...
const sunday_callin_amount = isManagement ? 0 : ...
const public_holiday_amount= isManagement ? 0 : ...
```

**An employee on a fixed monthly salary receives no Sunday premium at all.** They are paid
`monthly_salary`, flat.

P-01's population is "employees on a fixed monthly salary". The engine's population for
`sunday_amount = 0` is the same set. So the manually entered Sunday base rate would be entered,
validated, warned about, acknowledged, audited — and then multiplied by zero hours into a
component hardcoded to zero.

P-02 compounds it: it validates the entered rate against "the employee's calculated ordinary
rate". A management employee has no calculated hourly rate to compare against — `rate` falls
back to `hourly_rate || min_wage_security`, which for a salaried manager is either an unused
legacy value or the statutory minimum. The comparison would warn on essentially every row, and
P-03 would then demand an acknowledgement for a warning that means nothing.

This is not a bug to fix. Making P-01 work would mean deciding that salaried management earns
Sunday premiums — a real compensation change nobody asked for.

## 3. What UAT_REQUIREMENTS.md actually asks for

§2 asks the system to **store the basis used for every Sunday payment** (normal, 1.5×
arrangement, or another approved rule) and to capture consent and equal time off. That is a
*provenance and evidence* requirement about which rule was applied and why.

It does not ask anyone to type in a rate. Nothing in §1–§7 asks for manual rate entry, rate
validation, or a rate-difference acknowledgement. The word "manual" appears in the requirements
only in "manager approval remains human" (§6) and the manual scheduling path (§4).

## 4. Where these decisions came from

`DECISIONS.md` opens with the reason:

> Keeper's decision queue drifted: from `D-05` onward the agent improvised its own
> follow-up questions but saved the answers against the *next unanswered UAT ref*.

P-01 is stored against **D-05**, whose real UAT question was *"Which Sunday work categories must
the system distinguish (rostered / relief-and-call-in / public holiday)?"* — that is UAT-03.
P-02 is stored against **D-06**: *"What exactly counts as a premium opportunity for the fairness
cap?"* P-03 against **D-07**, the fairness cap and its authority.

So the P-01→P-12 chain is a **displacement**. Philip spent nine decisions answering questions
Keeper invented about a feature nobody requested, while the three real questions underneath them
went unasked. Two of those three — D-06 and D-07 — were finally answered on 2026-09-03, in this
session, and are what unblocked the premium fairness work.

## 5. Assessment

Removing it was right, for a stronger reason than the changelog gave. The changelog said "no
basis in UAT_REQUIREMENTS". The actual position is:

1. The feature's own premise is void against this engine — its target population is precisely
   the population whose Sunday pay is hardcoded to zero.
2. Building it would have required an undecided compensation change (paying salaried management
   Sunday premiums) to become meaningful at all.
3. It answers questions that were never asked, generated by a known tooling fault, and it
   displaced three real UAT questions.

The decisions themselves were sound reasoning about a feature that should not exist here.

## 6. What is lost, and where it should go instead

One idea in this chain is worth keeping. P-03's shape — *an authorised user must acknowledge a
flagged condition before payroll can be submitted, with user, timestamp, values and reason
logged* — is a good pattern and §2 genuinely needs something like it:

> Prevent payroll finalisation where the supporting rest/consent record is absent or
> unresolved; an authorised compliance exception requires a reason and audit trail.

If the Sunday 1.5× gate is ever tightened beyond the current blanket rate (Philip chose to keep
the blanket 1.5× on 2026-09-03 and record the exposure), P-03/P-08/P-10's design should be
reused for it: acknowledgement keyed to the exact values reviewed, invalidated when they change,
scoped to one submission. That is the durable part.

## 7. Recommendation

Close P-01, P-02, P-03, P-07, P-08, P-09, P-10, P-11, P-12 as **descoped — premise void against
the engine, generated by queue drift**, citing §2 and §4 above. Carry P-03's acknowledgement
pattern forward as a note against §2's finalisation gate so the reasoning is not lost if that
gate is ever built.
