# SaaS building notes for this software

Notes for turning this build into a product for **other** security companies.

This repo was built for one client. Some of what it does is that client's policy, not
Namibian law and not a sensible product default. Those decisions are recorded here so a
future session can find and unwind them instead of shipping one company's rules to
everybody.

**If you are Claude reading this in a later session: treat every entry below as
tenant-specific. Before reusing this codebase for a new customer, work through this list
and decide each item afresh with the new client.**

---

## 1. Sunday pay is 1.5× for everyone

**Date:** 2026-07-24
**Client:** the current tenant (Namibian security company)
**Status:** deliberate, client-instructed, shipped

### What the code does now

- A **Sunday** shift the guard was **rostered** for pays **1.5×**.
- The **2×** rate applies **only** when the guard was called in as a **replacement** for
  someone marked absent (`schedule_assignments.is_replacement = true`).
- This applies to every employee. There is no per-employee opt-in.
- **Public holidays are unaffected: 2× for everyone, rostered or not.** The contractual
  agreement covers Sundays only.

### Why

The client's employment contract makes the Labour Act s.21 agreement — the written
agreement that lets an employer pay 1.5× instead of 2× for ordinary Sunday work — a
condition of being hired. Their position is that every guard has therefore already agreed,
so 1.5× is simply the rate.

Philip's own words, 2026-07-24:

> "the guy im building for says in their contract they are already made to agree to that
> 1.5x, so if anybody gets a sunday shift they get that, not 2x, i know its not compliant
> but ey, only if someone is marked absent and you are called in as a replacement can you
> get that 2x"

### Why this must not become the product default

The client and Philip both know this sits at the edge of compliance. Labour Act s.21
contemplates an agreement with an employee who *ordinarily* works Sundays; a blanket
condition of hire, applied to every guard whether or not Sundays are ordinary for them, is
not obviously the same thing. **This is the client's legal exposure, taken with their eyes
open — it is not advice this codebase should hand to the next customer.**

The financial size of it, measured on live data (approved shifts, 24 May – 19 Jul 2026):
2,556 Sunday hours across 58 guards moved from 2× to 1.5×, roughly **N$23,000 less over
two months** (~N$11–12k/month).

### How to undo it

The per-employee mechanism was **not deleted**, only bypassed, precisely so this is cheap
to reverse:

- `employees.ordinarily_works_sundays` still exists in the database and is still populated
  (9 of 330 were true as at 2026-07-24). Nothing reads it for pay any more.
- `src/lib/payroll-engine.ts` → `calculateNetPay`: `sunday_amount` uses
  `constants.sunday_agreed_multiplier` unconditionally. To restore the law-shaped
  behaviour, gate it on `employee.ordinarily_works_sundays` again.
- `src/lib/payroll-engine.ts` → `estimateShiftCost`: same assumption, since anything being
  costed is by definition being rostered.
- `src/routes/_app.employees.$employeeId.tsx`: the "Ordinarily works Sundays" Yes/No
  selector was replaced with a static line. The mutation that wrote the column was removed
  — restore both to give the flag a UI again.
- `src/lib/payslip-pdf.ts`: the rostered Sunday line falls back to 1.5× when the effective
  rate can't be derived; the call-in line and public holidays fall back to 2×.

The call-in split itself (`sunday_callin_hours` / `sunday_callin_amount`) is **good product
behaviour and worth keeping** — paying the full premium to someone dragged in at short
notice is correct under any reading. Only the "everyone is agreed" part is tenant policy.

### Loose end

`payroll_runs` has no call-in column, so a finalized run stores one combined Sunday total.
Reprints of a finalized period show a single Sunday line at its effective (blended) rate
rather than the two-line split. If a future customer needs the
split preserved on historical payslips, that needs a migration.

---

## 2. Monthly hour cap (240h) ships switched off

**Date:** 2026-07-20
**Status:** written, not applied — awaiting client decision

`supabase/migrations/20260719180000_monthly_hour_caps.sql` hard-blocks rostering a guard
past 240 hours a month. It has **not** been applied, because the client's actual 6-day ×
12-hour pattern is about 264 hours and enforcing the cap means roughly 20 shifts per guard
per month and more headcount. Attendance warns instead.

For a product default: warn, don't block. The cap is real law but the business consequence
is a staffing decision no vendor should make for a customer.

## 3. The 10-off-days-per-period rule reports rather than blocks

**Date:** 2026-07-20
**Status:** deliberate

23 of 32 rostered guards were already under 10 off days on live data (minimum 8) — a 6-day
pattern over a 31-day period cannot produce 10. Blocking would have made the roster
unsaveable on day one. Same reasoning as the hour cap. See `src/lib/roster-rules.ts`.
