# How leave is calculated

This system earns annual leave from **days an officer actually works**, not from a number
chosen at onboarding. Security schedules are irregular — people work more or fewer days than
any fixed plan — so leave is derived from real, approved attendance. Nobody is favoured for
working more or less.

## The rule

> **1 leave day is earned for every 12 days actually worked.**

Each time a payroll period is finalized, every active officer is credited:

```
days accrued this period = (approved work days in the period) / 12
```

A "work day" is **one distinct calendar date** on which the officer has an **approved** shift
log for real work. It does not matter whether it was a day shift, night shift, Sunday, or
public holiday — each counts as one worked day. The following do **not** count:

- Off-days (`pay_rule = off`)
- Leave shift types (the leave you take doesn't earn more leave)
- Attendance that isn't **approved** yet — `pending`, `submitted` (awaiting payroll approval),
  `no_show`, `suspended_unpaid`, and `replaced_by_other` are all excluded

> Note: a double shift still counts as **one** worked day, because accrual is counted in days,
> not hours.

## Why 1 in 12

This is the Namibian Labour Act s.23 entitlement (≈ 4 weeks of leave per 12-month cycle),
re-expressed as a per-day rate so it works for any schedule:

- A full working year is about **52 weeks**, of which roughly **4 weeks are taken as leave**,
  leaving about **48 weeks actually worked**.
- The entitlement is **4 weeks** of leave for those **48 weeks** of work.
- That ratio is `4 ÷ 48 = 1⁄12`, **independent of how many days per week the officer works**.

Worked examples over a full year:

| Officer works            | Days worked / yr | Leave earned (÷12) |
| ------------------------ | ---------------- | ------------------ |
| 6 days/week consistently | ~288             | ~24 days           |
| 5 days/week consistently | ~240             | ~20 days           |
| Irregular / variable     | whatever it is   | exactly that ÷ 12  |

So the steady 6-day worker lands near the statutory 24 days and the 5-day worker near 20 —
automatically — while an officer with an uneven schedule simply gets exactly what they earned.

## What it means in practice

- **No onboarding guess.** The "Typical days / week" field on an officer's profile is a
  scheduling guide only. It has **no effect** on leave. You can change it freely.
- **Self-correcting and fair.** Work more days, earn more leave; work fewer, earn less — in
  direct proportion. Two officers are treated identically per day worked.
- **Only approved work counts.** Leave reflects attendance that payroll has approved, so it
  can't be inflated by unapproved or no-show entries.
- **Idempotent.** Each (officer, pay period) accrues once. Re-finalizing a period does not
  double-credit leave.

## Where it lives in the code

- **Accrual logic:** `public.finalize_payroll_period(p_period)` — runs when payroll finalizes a
  period. Migration: `supabase/migrations/20260628120000_leave_accrual_from_worked_days.sql`.
- **Ledger:** `public.leave_accruals` — one row per (employee, pay period), the audit trail of
  what was accrued and when. Its `unique (employee_id, pay_period_id)` guarantees idempotency.
- **Running balance:** `public.leave_balances.annual_days` — the officer's current leave
  balance, shown on the employee profile's **Leave** card.
- **Attendance source:** `public.shift_logs` (status `approved`) joined to `public.shift_types`
  (to identify real work vs. off/leave).
