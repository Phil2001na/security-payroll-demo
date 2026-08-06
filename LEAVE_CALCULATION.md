# How leave is calculated

Leave is measured in **scheduled working days**, not generic calendar weekdays. A request range can include Sundays, public holidays and rest days; only dates on which the employee had a published working assignment consume leave. Multiple assignments on one date consume one leave day but create one relief requirement per shift.

## Annual leave

The statutory floor is four ordinary work weeks per 12-month annual cycle:

| Ordinary work pattern | Annual entitlement |
| --------------------- | -----------------: |
| 6 days/week           |    24 working days |
| 5 days/week           |    20 working days |
| 4 days/week           |    16 working days |
| 3 days/week           |    12 working days |
| 2 days/week           |     8 working days |
| 1 day/week            |     4 working days |

The system accrues an exact daily fraction of that cycle entitlement in each finalized payroll period:

```text
daily accrual = ordinary days/week × 4 ÷ actual days in that employee's 12-month cycle
period accrual = sum of the daily accruals through the employee's last working day
```

Legitimate absence therefore does not reduce annual-leave entitlement. `days_per_week` is the employee's ordinary pattern and must be maintained accurately. A cycle record preserves the applicable dates and four-week entitlement. Each `(employee, pay period)` accrues at most once.

## Sick leave

- The sick cycle is 36 months from commencement/previous cycle.
- Five-day pattern: 30 working days; six-day pattern: 36; other patterns are pro rata at six days per ordinary weekly day.
- During the first year, one day is earned per 26 approved worked days. The entitlement is topped up as qualifying days accumulate.
- Unused sick balance expires at cycle end and the expiry is recorded in the immutable ledger.
- Medical evidence defaults to the third consecutive charged workday, reflecting absence for more than two consecutive days.

## Compassionate leave

Five fully paid working days are granted per 12-month cycle. Unused days expire at cycle end. The reason/evidence must support death or serious illness in the statutory family relationship; approval remains an HR responsibility.

## Maternity and unpaid leave

Maternity is tracked separately, requires six months' continuous service and at least 12 consecutive weeks, and preserves the statutory absence/coverage workflow. Employer-funded pay defaults to zero pending the employee's Social Security benefit and any contractual top-up, but an administrator can configure a 0–100% employer-paid portion. Unpaid leave is fixed at zero pay. Both retain original planned hours for absence reporting and transport proration; maternity also persists its paid-hour portion so historical payslips reconcile.

## Payroll and audit

Paid leave hours equal original planned hours multiplied by the policy's paid percentage. Annual, sick and compassionate leave are fixed at the statutory 100% pay floor; maternity can carry a contractual employer-paid portion; unpaid leave is always zero. All five absence categories persist separately in `payroll_runs` and print separately on payslips. Annual/sick/compassionate usage, entitlement, accrual, adjustment, reversal and expiry entries are retained in the immutable `leave_ledger`; `leave_balances` is the current projection.

The implementing migration is `supabase/migrations/20260803181750_leave_management_module.sql`. Execute `LEAVE_UAT.md` in a disposable database before deployment.
