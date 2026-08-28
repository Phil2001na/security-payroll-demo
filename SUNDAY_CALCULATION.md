# Sunday & midnight-crossing pay calculation

How the payroll engine pays a shift that crosses midnight, how the Sunday boundary rule is
configured, and what entitles a Sunday to the reduced 1.5× rate. Implements the confirmed
business decisions from the security/payroll UAT (source requirements:
`uat/2026-08-20/UAT_REQUIREMENTS.md`).

This is a product/implementation record, not legal advice. Items marked **open** still need
the client's or labour counsel's confirmation.

## One stored shift, many payroll segments

A shift that runs past midnight is **one** roster record and **one** attendance record. It is
never split into two operational shifts, and nothing in this work creates a second
`schedule_assignments` or `shift_logs` row for a midnight crossing.

Splitting happens only inside the calculation. `segmentShift()` in
`src/lib/shift-segments.ts` walks the stored shift's clock interval and cuts it at every rule
boundary it crosses, then each segment is paid under the day rule that applies to it.

```
stored shift   shift_logs: date 2026-08-22 (Sat), start_min 1080 (18:00), hours_worked 12
payroll        Sat 18:00–24:00   6h   ordinary
segments       Sun 00:00–06:00   6h   Sunday
pay            6 × rate + 6 × 1.5 × rate   (15 base-rate hours)
```

The segments are exposed in the payroll breakdown and stored on the run
(`payroll_runs.calculation_breakdown`) so the figure is auditable rather than a hidden total.

Guarantees, all covered by `tests/shift-segments.test.ts`:

- segments are contiguous and never overlap — the midnight minute belongs to exactly one side;
- Σ segment minutes === the stored shift duration, so no minute is lost or counted twice;
- the stored shift row is only ever read;
- the result is independent of the host timezone (dates are wall-clock, arithmetic is UTC-based).

### Where the shift's clock comes from

`shift_logs` stores an anchor date and worked hours; the clock window comes from
`shift_types.start_min`. The engine derives the shift's real start and end from those three
values and reports them on every segment line (`shift_starts_at` / `shift_ends_at`). There is
no clock-in/clock-out capture in the system today, so no separate timestamp columns were
added — see **Open questions**.

## Configurable Sunday boundary rule

The applicable interpretation is a client/labour-counsel decision, so it is configuration, not
a constant: `payroll_constants.sunday_boundary_mode`, a numeric code because that column is
numeric.

| Code | Mode | Effect |
| --- | --- | --- |
| `0` | `midnight_split` | **Default.** Cut at midnight; each side is paid under its own calendar day. This is what the UAT asked for and what the engine already did. |
| `1` | `majority_of_shift` | Labour Act s.21(8) reading: the whole shift takes the rule of the day holding the majority of its minutes. |
| `2` | `shift_start_day` | The whole shift takes the rule of the calendar day it started on. |

An absent or unrecognised code resolves to `midnight_split`, so a tenant without the row is
paid exactly as before.

**Ties need no separate tie-breaker.** Under `majority_of_shift` an exactly even split — the
18:00–06:00 shift the UAT raised is a 6/6 tie — resolves to the highest-rate day rule
(public holiday > Sunday > ordinary) and records a warning saying so. The mode resolves the
shift on its own; there is no second setting to configure or keep in step.

Segments are still produced and shown under every mode. When the mode moves a segment off its
own calendar rule, the segment carries a `rule_reason` explaining it, so the breakdown says
why a Sunday segment was paid as ordinary work.

Two things override the boundary mode, both deliberately:

- a **public holiday** outranks the Sunday rule on the same day;
- an **explicit Sunday / public-holiday shift type** (`pay_rule` of `sunday_default`,
  `sunday_ordinary`, `public_holiday_*`) fixes the whole shift, because that is an operator
  decision about the whole shift. The breakdown records that it was forced and by which rule.

## Sunday basis: what earns the reduced 1.5×

The statutory default for Sunday work is 2×. The reduced 1.5× is an *agreed* rate and needs a
basis on file. The client confirmed the basis is the **standing consent already signed into
the employment contract** — payroll does not chase a fresh consent action for each individual
Sunday shift, and the system does not ask for one.

`evaluateSundayConsent()` in `src/lib/sunday-consent.ts` reads existing `employees` columns:

| Basis | Condition | Multiplier |
| --- | --- | --- |
| `contract_agreed_1_5x` | `sunday_agreement_url` present (a separately signed Sunday agreement) | `sunday_agreed_multiplier` (1.5×) |
| `contract_agreed_1_5x` | `ordinarily_works_sundays` **and** `contract_signed_at` present | `sunday_agreed_multiplier` (1.5×) |
| `statutory_default_2x` | anything else — consent missing, unsigned or unverifiable | `sunday_multiplier` (2×) |

When the basis cannot be verified the calculation **falls back to 2×**, payroll still runs,
and the reason appears in the payslip's compliance warnings and in
`calculation_breakdown.sunday_consent_reasons`. The 1.5× is never granted silently with no
basis on file.

Replacement call-ins are unchanged and separate: a guard called in to cover someone else never
agreed to that Sunday, so those hours stay at the full 2× default whatever the consent record
says (`sunday_callin_hours`).

### Conflict with the previous behaviour

Before this change the engine applied 1.5× to **every** rostered Sunday for **every**
employee, ignoring `ordinarily_works_sundays` and any consent record — a documented tenant
policy ("the contract makes the s.21 agreement a condition of hire"). The UAT decision
overrides it: missing or unverifiable consent now pays 2×.

**This changes money.** Any employee whose contract is not marked signed, or who is not
recorded as ordinarily working Sundays, moves from 1.5× to 2× on rostered Sunday hours.
Before the first payroll run after this ships, check `employees.contract_signed_at` and
`employees.ordinarily_works_sundays` are populated for everyone who genuinely has the
standing consent — otherwise the fallback will fire for them and overpay against the client's
intended policy. The compliance warnings name every affected employee.

## Manual Sunday base rate and its acknowledgement

Payroll may enter a Sunday base rate for each pay period
(`payroll_sunday_rates`, one row per period). It is validated against the ordinary rate the
run calculated:

- **matching** — nothing to do;
- **differing** — the difference is shown in money and percent, per employee where rates vary.
  Payroll continues: a difference on its own never blocks submission.

What does gate submission is an **unacknowledged** difference. An authorised user
(`payroll` or `admin`) acknowledges it, and the acknowledgement records the actor, the
timestamp, both rate values and an optional reason. Unauthorised users cannot acknowledge on
payroll's behalf: `acknowledge_sunday_rate_variance` is `SECURITY DEFINER` and checks the
caller's role, and `payroll_sunday_rates` has no insert/update/delete RLS policy at all, so
every write goes through the RPCs. `finalize_payroll_period` re-checks the acknowledgement, so
the gate holds even if the screen is bypassed.

Re-entering the rate clears the acknowledgement — an acknowledgement only ever covers the
values it was given for.

Where a Sunday base rate is recorded for the period, it replaces the employee's ordinary rate
as the base for Sunday premium hours (the applicable multiplier is unchanged). Ordinary,
overtime and public-holiday hours stay on the employee's own rate. See **Open questions**.

## Working-time rules (unchanged)

The roster rule set the UAT confirmed as complete is in `src/lib/working-time-rules.ts`,
extracted from the Schedule page so it can be regression-tested. Same checks, same order,
same wording:

1. only standard Day or Night working shifts may be rostered;
2. one shift per employee per calendar date;
3. the 60-hour weekly cap;
4. the six-workday weekly rest day;
5. Night → next-Day conflict;
6. Day → next-Night conflict.

**No minimum rest-gap rule (an 11-hour gap between shifts or similar) was added**, per the
UAT decision. `tests/working-time-rules.test.ts` pins that: a six-day run of consecutive Day
shifts is allowed on rest grounds alone.

## Open questions

These genuinely need the client or labour counsel, and are deliberately left unresolved:

1. **Which Sunday boundary mode applies.** The system supports all three; the default preserves
   today's behaviour. The mode is a per-tenant setting, not a code change.
2. **Whether the tie rule is right.** `majority_of_shift` resolves a 6/6 split to the
   highest-rate day. The statute does not resolve a tie, so this is our choice, not the law's.
3. **What the standing contract consent must contain**, and whether `contract_signed_at` plus
   `ordinarily_works_sundays` is an acceptable proxy for it, or whether a per-employee signed
   Sunday clause reference is required. The UAT also mentioned matching equal time off in the
   next working week as part of the s.21 basis; that is not modelled here and would be a
   separate decision.
4. **Whether the manually entered Sunday base rate should drive pay** (as implemented) or be
   a check-only value that warns but never changes an amount.
5. **Whether the Sunday base rate is period-wide** (as implemented) or per employee. A single
   period rate only makes sense while guards share one ordinary rate; the validation already
   reports every employee it differs from.
6. **Clock-in/clock-out capture.** Attendance stores hours worked, not actual start/end
   timestamps; the shift's clock window comes from the shift type. If real captured times are
   wanted on the record, that is a separate piece of work.
