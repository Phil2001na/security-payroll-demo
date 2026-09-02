# UAT 2026-08-20 — outstanding decisions resolved 2026-09-03

**Decided by:** Philip, as product owner.
**Context:** the UAT files record these as "client/legal decision required". There is no live
client and no real payroll — the data is fabricated demo data — so there is nobody to defer to.
These are product decisions, recorded here so the UAT files stop showing open gates against
questions that are in fact answered.

Where a decision rests on a reading of Namibian statute rather than a settled interpretation,
that is stated. None of this is legal advice.

---

## 1. UAT-01 — Sunday boundary rule *(closes D-01, D-02)*

**Decision:** ship `midnight_split` as the default.

The rule stays configurable per tenant. `majority_of_shift` remains available; a 6/6 tie under
that mode still refuses to calculate rather than guessing.

**Why:** it matches the client's own worked example in §1 (Sat 18:00–Sun 06:00 = 6h normal +
6h at 1.5× = 15 base-rate hours). Defaulting to the statutory majority test would turn every
12-hour boundary-crossing shift into a tie and block payroll on common night rosters.

## 2. UAT-02 — Sunday 1.5× gate *(D-04)*

**Decision:** keep the blanket 1.5× for rostered Sundays. Do not add a consent or rest-evidence
gate. Record the exposure.

**Exposure, stated plainly:** Labour Act s.21 makes the reduced 1.5× rate conditional on **both**
the employee's agreement **and** equal time off in the following working week. The engine checks
neither. It pays 1.5× to every rostered Sunday on the assumption that the employment contract
makes the agreement a condition of hire, and 2× to call-ins. If that contractual assumption does
not hold for a given employee, that employee is underpaid relative to the statutory default.

`employees.sunday_agreement_url` exists and is still unread by any code path.

## 3. UAT-07 / §3 — premium opportunity definition *(closes D-06)*

**Decision:** **every** Sunday-working shift counts — day or night, rostered or call-in.

**Why:** the cap measures lucrative work received, not favours granted. A call-in pays 2×, so
the guard did get the premium.

**Known consequence:** a guard called in at 02:00 to cover a sick colleague burns their slot for
the window. On a small site roster this can cascade into unfillable Sundays. The configurable
window (§3 notes 2–3 months may suit a large workforce) is the mitigation.

## 4. UAT-07 — premium cap enforcement *(closes D-07, D-08, D-10)*

**Decision:** exclude from suggestions, warn on manual assignment. Not a hard block.

Auto-fill and candidate ranking drop an over-cap guard and show why. A supervisor manually
assigning them anyway is warned, naming the prior premium Sunday, and may proceed.

**Why:** fairness is a scheduling preference, not a statutory limit. Nothing unlawful happens
when it is exceeded, unlike the 60-hour cap. Default window: one opportunity per calendar month,
configurable per tenant.

## 5. UAT-05 / UAT-08 / UAT-09 — scheduling limits *(closes D-10's second limb)*

**Decision:** hard block with an admin-only emergency override.

Breaching a daily/weekly/rest limit refuses the assignment on **every** path — manual, auto-fill,
custom coverage, relief — and names the failed rules and the staffing gap. An admin may record
an override carrying a mandatory reason and an explicit legal-risk acknowledgement, raised as its
own audit event and never as an ordinary roster edit. The shortage record is still created.

Reuses the record→verify→confirm chain in `src/lib/approvals.ts`, which already enforces that
one person cannot fill two roles.

## 6. UAT-14 / §7 — leave capacity cap *(closes D-15)*

**Decision:** both checks, warn only.

- Tenant-wide monthly headcount cap, default 10, configurable with effective date and policy owner.
- Per-site, day-level coverage check across every day of the requested range at the employee's
  home site.

The approver sees both figures **and** the employee's statutory deadline risk before deciding,
and may approve past either. The decision and its reason are recorded.

**Why warn and not block:** §7 is explicit that a monthly cap must not silently defeat statutory
leave timing. A hard block would let a headcount policy override a legal deadline.

Resolution of a cap-versus-deadline collision (D-16) remains **out of scope** — show the
conflict, do not resolve it.

## 7. UAT-13 — directed-leave evidence

**Decision:** typed acknowledgement plus attachments. No signature-capture UI.

Record: who offered, dates offered, reason, employee response (acknowledged / refused /
refused-to-sign), optional witness, optional file attachments for a scanned paper form, the
recording user and timestamp. Append-only once saved. Exportable.

**Why:** a drawn on-screen signature's evidentiary weight in a Namibian labour dispute is itself
unreviewed, so it would add build cost for unproven benefit. An attached scan of a signed form is
the stronger artifact.

## 8. UAT-17 — recruitment scope

**Decision:** shortage reporting only. No applicant pipeline.

Build the UAT-10 weekly Ops/HR report grouping recurring shortages by site, shift and required
skill. §5 states no applicant portal was requested for guards, and the driver/supervisor link is
"not yet a defined requirement".

## 9. Public holidays falling on a Sunday

**Decision:** both days pay 2×.

Public Holidays Act 26 of 1990 s.1(2) provides that a holiday falling on a Sunday **adds** the
following Monday; it does not move the holiday off the Sunday. Both dates are seeded and both
attract the 2× public-holiday multiplier, so a guard rostered across that weekend can receive
two consecutive double-pay days.

**Status:** this is a reading of the statute, taken on the employee-protective side of an
ambiguity. It has not been reviewed by counsel.

## 10. 2025 public-holiday backfill

**Decision:** leave 2025 alone.

The live calendar holds 7 rows for 2025, all before 25 May; six holidays are missing. They stay
missing. Backfilling would create a calendar that disagrees with what finalized 2025 periods
actually paid, and repricing them would rewrite finalized payroll records.

Recorded as known-bad demo data.

## 11. Leave-cycle rollover asymmetry *(D-19)*

**Decision:** unresolved — flagged for labour-law review.

Annual leave carries over untouched; sick and compassionate lapse. D-19 only ever asked about
annual leave, so the other two were never decided and may be inherited rather than intended.

A regression test will assert the **current** behaviour, explicitly labelled as characterisation
of undecided behaviour rather than a confirmed rule.

## 12. P-01 → P-12 — manual Sunday rate workflow

**Status:** re-examination requested before closing. See `P01-P12-REEXAMINATION.md`.

---

## Still open after this round

| Ref | Open question |
| --- | --- |
| D-04 | Whether equal time off must be evidenced per Sunday, and what counts as evidence. Deferred by decision §2 above, not answered. |
| D-16 | How a leave-capacity conflict with a statutory deadline is escalated and resolved. |
| D-19 | Whether sick/compassionate lapsing on rollover is intended (§11). |
| P-13 / P-14 | Whether and when annual leave lapses. Requires labour counsel; the Act bars payment in substitution except on termination. |
| — | Sunday-holiday double premium (§9) is an unreviewed statutory reading. |
| — | Keeper's live DB still stores D-09 as the opposite of the decision; D-08/D-15 reopened in error; P-09 never persisted. |
