# Business Rules Overview
## DogForce Security Service — pay, leave and rosters

**Prepared for:** DogForce Security Service
**Date:** 16 September 2026 (version 1.3)
**Updated after your review of 15 September 2026.** Four sections have been changed to match what you told us, and the system has already been changed to match. The changed sections are **3, 6, 7 and 8** — please read those four again and check we got them right.

---

## 1. What this is, and how to use it

This document lists every rule the system uses to work out pay, leave and rosters.

You should be able to read it without any technical knowledge. If a part of it does not make sense, that is our problem to fix, not yours.

**Nothing here is a suggestion.** Every rule below is what the software does today.

**Please mark each section:**

| Mark | What it means |
|---|---|
| **Confirm** | This is how DogForce works. Leave it alone. |
| **Change** | This is wrong. Tell us what it should be. |
| **Question** | You are not sure, or you want to talk about it. |

Under each section there is a box. **Write the correction, or your question, in your own words.** Please do use it. If you mark something "Change" but write nothing, we cannot act on it.

On the web version, your answers save on their own as you type. You can close the page and come back to it later.

Seven things still need a decision from you. They are marked **Needs your decision** and listed together in section 13. Two of them are needed before we run the first payroll. The night rate (decision 1) is now settled — see section 7.

---

## 2. How a guard is paid

Guards are paid **by the hour**.

Each guard has one hourly rate. Pay is that rate times the hours they worked. Extra pay is added on top for Sunday, public holiday and night work.

There are no pay grades. There are no different rates for different sites. One rate per person.

The rate for a guard is **N$16.00 an hour**. This is the minimum wage for the security industry.

The system also holds N$16.00 as a floor. If anyone is paid less than that, a warning appears on their payslip.

### The minimum wage goes up again

The security industry minimum wage was agreed in steps:

| Year | Rate |
|---|---|
| 2025 | N$13.50 an hour |
| **2026 (now)** | **N$16.00 an hour** |
| 2027 | N$18.00 an hour |

**The system will not raise the rate on its own.** When 2027 comes, someone has to change it. Please put a reminder in your diary.

### Managers

Managers are paid a **fixed amount each month**. Their pay is not worked out from hours.

They get no overtime, and no extra pay for Sundays, holidays or nights. Like everyone else, they get no allowance — see section 8.

**Confirm / Change / Question:** ______________________

---

## 3. The working day

### Shift types

| Code | Name | Hours | Times |
|---|---|---|---|
| DAY | Day Shift | 12 | 06:00 – 18:00 |
| NIGHT | Night Shift | 12 | 18:00 – 06:00 |
| DAY6 | Half Day Shift | 6 | 06:00 – 12:00 |
| NIGHT6 | Half Night Shift | 6 | 18:00 – 00:00 |
| SUN | Sunday Shift | 12 | 06:00 – 18:00 |
| PH | Public Holiday | 12 | 06:00 – 18:00 |

> **Changed 15 September 2026.** You told us shifts start at 06:00 and 18:00, not 07:00 and
> 19:00. The times above are the corrected ones, and the system now uses them. This also
> matches your service list, which already prices guarding as 06h00–18h00 and
> 18h00–06h00 — the roster was the side that was wrong.

There are five more types for leave: annual, sick, compassionate, maternity and unpaid. These take up a day on the roster, but they are not work.

### The 12-hour limit

**No shift can be longer than 12 hours.**

The system will not accept one. Nobody can override this — not a supervisor, not a manager, not an administrator. A 13-hour shift cannot be recorded at all.

**Confirm / Change / Question:** ______________________

---

## 4. Normal hours and overtime

**Normal hours stop at 60 a week.** Anything over 60 in one week is overtime, paid at **1.5 times** the hourly rate.

The week runs **Monday to Sunday**.

Overtime is counted by the week, not by the day. A 12-hour day is not overtime on its own. Only the hours past 60 in that week are.

### Sunday and holiday hours are kept separate

This is the part people ask about most, so here it is in full.

The system puts hours in **two separate baskets**:

| Basket | What goes in it | How it is paid |
|---|---|---|
| **Normal hours** | Monday to Saturday work | First 60 hours a week at the normal rate. Anything over 60 at 1.5 times. |
| **Sunday and holidays** | Sunday hours, public holiday hours | At their own higher rate. **Never counted towards the 60.** |

**Here is what that means.** Say a guard works five 12-hour days in the week, and a 12-hour Sunday:

- The five weekdays put **60 hours** in the normal basket. That fills it exactly. **No overtime.**
- The Sunday's 12 hours go in the other basket, paid at 1.5 times.

If Sunday hours *did* count towards the 60, the same guard would be on 72 hours, with 12 of them overtime. Those 12 hours would then be paid 1.5 times for overtime *and* 1.5 times for Sunday. Keeping the baskets apart is what stops that from happening.

### 60 hours is also a limit on the roster

The system **will not let you roster** a shift that takes a guard past 60 hours in a week. It refuses. It does not just warn you.

**With 12-hour shifts, 60 hours is five shifts.** A sixth 12-hour day in the same week is refused.

So five shifts a week is the real limit. That is about twenty working days a month, and about 240 hours.

Each guard's record has a **maximum days per week**. That number is a ceiling for the roster — the most days that guard can be given. It is not a promise of work, and it does not affect their pay or their leave.

There is one way past the 60-hour limit: a **PS exemption**. This is a written waiver with a date and a reference number, recorded against one named guard for one set period. Only an administrator or an operations manager can create one, and every change to it is logged.

An exemption only lifts the 60-hour weekly limit. It does not lift the 12-hour daily limit, the weekly rest day, or the monthly rest days.

**Confirm / Change / Question:** ______________________

---

## 5. Sunday work

There are two Sunday rates. Which one applies depends on how the guard came to work that day:

| Situation | Rate |
|---|---|
| **On the roster** — the Sunday was planned | **1.5 times** the hourly rate |
| **Called in** — for example, to cover someone absent | **2 times** the hourly rate |

The lower 1.5 times rate applies because **Sunday work is part of the standard contract**. Guards agree to work Sundays when they are hired. The law allows the lower rate on that basis.

The law also asks for something else: the guard should get the same amount of time off in the following week. **The system does not track this.** You manage it yourselves.

### Shifts that cross midnight

A shift that crosses midnight is **split at 00:00**. Each half is paid at the rate for the day it falls on.

**Here is the example you gave us.** A guard works Saturday 18:00 to Sunday 06:00:

- Saturday 18:00 to midnight = **6 hours at the normal rate**
- Midnight to Sunday 06:00 = **6 hours at 1.5 times** = 9 hours of pay
- Total: **15 hours of pay for 12 hours of work**

There is another way to do this: give the whole shift to whichever day holds most of it. The system can do that, but it is switched off, and we suggest leaving it off. A 12-hour shift split evenly across midnight has no majority day, so the system would have to stop and ask you every time.

**Confirm / Change / Question:** ______________________

---

## 6. Public holidays

Public holiday work is paid at **1.5 times** the hourly rate.

It is 1.5 times for everyone, whether they were rostered or called in.

> **Changed 15 September 2026.** You told us: “the rate we are using is 1.5 not x2
> because we are shift based and we are giving employees ample time.” The system now
> pays 1.5 times.
>
> **Please read this next part carefully.** The Labour Act's own figure for holiday work is 2
> times. 1.5 times is lower than that. We have made the change because you asked for it, and
> it is recorded as your decision with the date. We are not able to tell you it is within the
> law — that is a question for a labour lawyer, and section 14 says the same about
> the rest of this document.

### When a holiday falls on the same day as a Sunday

Now that holidays pay 1.5 times, the holiday rate is no longer always the higher of the two.
Which rate applies depends on whether the guard was rostered:

| Situation | Rate |
|---|---|
| Rostered for the day | 1.5 times |
| Called in to cover someone | 2 times |

The 2 times for a call-in is the Sunday rate, and it has not changed. A guard who agreed to
the day in their contract gets 1.5; a guard phoned at short notice, who never agreed to it,
gets 2. That is the same rule section 5 already describes for ordinary Sundays.

An earlier version of this document said “the holiday rate wins: 2 times, not 1.5”.
That was written when holidays paid 2 times and is no longer true.

### The holiday calendar

The system works out the thirteen Namibian public holidays every year, including the Easter dates that move:

New Year's Day · Independence Day · Good Friday · Easter Monday · Workers' Day · Cassinga Day · Ascension Day · Africa Day · Genocide Remembrance Day · Heroes' Day · International Human Rights Day · Christmas Day · Family Day

### The Monday after a Sunday holiday

The Monday after becomes a public holiday too, and **both days are paid at the holiday rate of 1.5 times**.

The law adds the Monday. It does not move the holiday off the Sunday, so the Sunday stays a holiday as well. This is why some years have more than thirteen holiday dates.

**Confirm / Change / Question:** ______________________

---

## 7. Night work

**There is no extra pay for night work.** A night hour is paid at the same rate as a day hour.

> **Settled 15 September 2026.** You told us: “The rates are the same, we are not
> paying the 6% because clients are also not paying the 6%.” This was decision 1 in
> the previous version and it is now closed. The system was already set this way, so no money
> changes.

The 6% night rate still exists in the system and is switched off. If DogForce ever start
charging clients for nights, it can be switched back on from the settings screen. No rebuild.

### Night hours are still counted

Night work counts from **20:00 to 07:00**. That window comes from the Labour Act and we do not
set it. The system still measures how many of each guard's hours fall inside it, and still
shows them on the payslip and the reports. They are simply paid at the normal rate.

Your night shift now runs **18:00 to 06:00**, so **10 of its 12 hours** fall inside that
window — the first two hours, 18:00 to 20:00, are before it starts. Under the old
19:00 start the figure was 11 hours. This changes a number on the reports, not the pay.

**Confirm / Change / Question:** ______________________

---

## 8. Allowances

**DogForce pay no allowances.** Nothing is added to a guard's pay on top of the hours they
work. There is no transport, housing, uniform or other allowance. Money that moves between
DogForce and a guard for anything other than hours worked is a **deduction**, and deductions
are section 9.

> **Changed 15 September 2026.** You told us: “Its not allowance its deduction.”
> Every guard's transport allowance has been set to zero, so it no longer appears on any
> payslip.
>
> **One thing we want to check with you.** We have read that as “guards get no
> allowances”. It could also mean something narrower — that DogForce
> provide transport and take the cost off the guard's pay. That would be a deduction, and it
> is not set up yet. If that second reading is the right one, tell us and we will add it to
> section 9.

The transport allowance has not been removed from the system, only set to zero. If DogForce
ever decide to pay one, it is a number to fill in, not a rebuild. For the record, this is how
it would work: an amount per month per guard, not taxed, going up and down with attendance —
a guard rostered for 20 days who works 18 would get 18/20 of it.

**Confirm / Change / Question:** ______________________

---

## 9. Deductions

### PAYE (income tax)

The system takes the pay for the period, multiplies by 12 to get a yearly figure, works out the tax on it, then divides by 12 again.

There is no allowance to leave out of this figure (section 8). If DogForce ever start paying a transport allowance, it would not be counted as taxable pay.

Here is the tax table in the system. It is the Namibian one that has applied since 1 March 2024:

| Yearly taxable pay | Tax |
|---|---|
| Up to N$100,000 | None |
| N$100,001 – 150,000 | 18% of the amount over N$100,000 |
| N$150,001 – 350,000 | N$9,000 + 25% of the amount over N$150,000 |
| N$350,001 – 550,000 | N$59,000 + 28% of the amount over N$350,000 |
| N$550,001 – 850,000 | N$115,000 + 30% of the amount over N$550,000 |
| N$850,001 – 1,550,000 | N$205,000 + 32% of the amount over N$850,000 |
| Over N$1,550,000 | N$429,000 + 37% of the amount over N$1,550,000 |

**What this means for a guard.** At N$16.00 an hour, a full month of about 240 hours is around **N$3,840**. Over a year that is about **N$46,000**. That is well under N$100,000.

**So guards pay no income tax at this rate.** The table matters for managers and senior staff.

Tax rates change in the national budget. When they do, someone has to update this table. The system will not do it on its own.

### Social security

**0.9% of gross pay, up to N$99 a month.**

The company also pays 1.8%. That is recorded, but it does not come off the guard's pay.

### Fines

A fine only comes off a guard's pay **if a collective agreement reference is recorded with it**. This is what the Labour Act requires.

If there is no reference, **the fine is not deducted**. It is listed separately instead, so you can see it was not taken.

This is on purpose. The system will not make a deduction that is against the law, and it tells you when it has refused to make one.

### Anything else

Loans, advances, union dues and anything similar are entered by hand, per guard, per period.

> ### ⚠ Needs your decision — 2. Union dues and pension
>
> Do you take off union dues or pension using a set rule — a percentage, or a fixed amount by grade?
>
> If so, that rule is **not in the system**. Tell us what it is and we will build it. Until then someone has to type these in by hand every single month.

**Confirm / Change / Question:** ______________________

---

## 10. Leave

### Annual leave

The law gives an employee **four weeks of leave a year**. The system builds that up as they work:

> **One day of leave for every twelve days worked.**

A full year of work is about 48 weeks. A guard working five days a week works about 240 days in that year. That earns **20 days of leave — which is four weeks of a five-day week.** A guard working six-day weeks works about 288 days and earns 24.

The rule sorts itself out. It matches whatever the guard actually worked, so nobody has to guess a pattern in advance.

- A "day worked" means a day with approved attendance on a real shift. Rest days and leave days do not earn leave.
- Leave is added when each payroll period is closed off.
- Two guards who worked different amounts earn different leave. Nobody earns leave for days they were not on the roster.
- **Annual leave does not expire.** Whatever is not taken carries over.

### The four-month rule

The law says the employer must set when leave is taken, and that has to happen **within four months of the end of the leave year**.

The system works out that date for every guard and shows it in the leave planner. It flags anyone getting close to it, or past it.

> ### ⚠ Needs your decision — 3. The deadline is shown, but not enforced
>
> Nothing stops leave being booked after the four-month deadline. The system shows the risk and lets the approver decide.
>
> Is that what you want? Or should the system refuse?

### Sick leave

Sick leave works differently from annual leave, on purpose. The law ties it to the normal working week, not to days actually worked. This is the one place where a guard's days-per-week figure decides an entitlement.

- The cycle is **36 months** (three years).
- **30 days** for a five-day week. **36 days** for a six-day week.
- **In the first year only:** 1 day builds up for every 26 days worked.
- A **doctor's note is needed from the third day in a row**. Without it, the request is refused.
- **No advance notice can be required.** The system enforces this.
- **Unused sick leave is lost** at the end of each three-year cycle.

### Compassionate leave

**5 days a year**, fully paid, no advance notice needed. **Lost** at the end of the year if not used.

> ### ⚠ Needs your decision — 4. Sick and compassionate leave expire, annual leave does not
>
> Nobody ever actually decided this. It may just be how it was built. We would like your view, and ideally a lawyer's.

### Maternity leave

- The guard needs **six months of service**.
- It must cover **at least twelve weeks in a row**.
- It does not use up any leave balance.

> ### ⚠ Needs your decision — 5. Maternity leave is set to unpaid
>
> Right now the system pays nothing for maternity leave.
>
> In Namibia the Social Security Commission normally pays the maternity benefit. What the employer adds varies from contract to contract.
>
> What is your policy? Nothing from DogForce, full pay, or a percentage? We need this before the first payroll, because it changes a payslip as soon as it applies.

### Unpaid leave

No pay, and no leave balance used.

### How leave gets approved

1. A supervisor, operations, payroll or admin user **submits** the request. A site supervisor can only submit for guards at their own sites.
2. An admin, operations or payroll user **approves or rejects** it.

**The person who submits a request cannot approve it.** The system enforces this and it cannot be turned off. Two people are always involved, on purpose.

A request is refused if:

- The dates fall in a pay period that is already closed.
- **There is no roster yet** for those dates. The roster has to be published first, because that is what decides how many days are actually used.
- Attendance has already been recorded for one of the days.
- The guard **does not have enough leave left** (annual, sick and compassionate).
- A doctor's note is missing where one is needed.

Once approved, the rostered shifts change to leave, and **a job is created for each shift** so operations knows exactly which posts need covering.

> ### ⚠ Needs your decision — 6. There is no limit on how many people can be on leave at once
>
> We designed one: a monthly cap on numbers, plus a check on each site's cover. Both were meant to warn the approver rather than block them, so they could go ahead with a reason recorded.
>
> **It has not been built.**
>
> What number do you want? And should it warn the approver, or stop them?

**Confirm / Change / Question:** ______________________

---

## 11. Roster limits

These rules live in the database itself, not on the screen. That means they apply no matter how a shift is created — typing it in by hand, generating a roster, filling a gap, or covering someone on leave. **Nobody can get around them.**

### Refused outright

| Rule | The limit |
|---|---|
| **Longest shift** | 12 hours. No exceptions. |
| **One shift a day** | A guard cannot work two shifts on the same date. |
| **Hours a week** | 60. Only a recorded PS exemption can lift this. |
| **Rest each week** | 6 working days a week at most. Everyone gets a full day off. |
| **Rest after nights** | A day shift cannot follow a night shift, and a night shift cannot follow a day shift. |
| **Rest each month** | At least 10 rest days in each calendar month. |
| **Shift type** | Rostered work has to use a day or night type. |

When the system refuses, it tells you which rule was broken.

### How these fit together

These are not separate obstacles. With 12-hour shifts they all point at the same pattern:

- 60 hours a week ÷ 12 hours a shift = **5 shifts a week**.
- 5 shifts a week is about **20 working days a month**.
- That leaves 10 or 11 rest days, which meets the monthly rest rule on its own.
- 20 shifts × 12 hours = **240 hours a month**.

The 60-hour rule bites before the 6-day rule does. So a sixth full shift is refused on hours, and the 6-day rule never even comes up.

### Warned about, but allowed

| Rule | The limit | What happens |
|---|---|---|
| **Hours a month** | 240 | Warning only |
| **Overtime a month** | 20 hours | Counted, not enforced |
| **Single rest days** | One day off between two runs of work | Preference only |

> ### ⚠ Needs your decision — 7. The 240-hour monthly limit is not enforced
>
> The 240-hour limit is set up, but it only warns.
>
> Look at the sums above. The rules that *are* enforced already put a full-time guard at about 240 hours. So turning this on would act as a **safety net**, not a new restriction. It would catch odd cases — a month with extra days, or shifts added after someone went off sick — instead of blocking normal rostering.
>
> **We suggest turning it on.** It is your call. The same question applies to the 20-hour overtime figure.

**Confirm / Change / Question:** ______________________

---

## 12. When a post cannot be filled

Sometimes there is nobody left who can work a shift — every available guard would break one of the rules above.

When that happens the system records a **shortage**. It saves the site, the date, the shift, how many guards were needed, how many were found, and which rules ruled people out.

You can see the **last 30 days of shortages** in the scheduler.

> ### ⚠ Needs your decision — 8. The weekly shortage report
>
> We planned a weekly report for Operations and HR, grouping shortages that keep happening. It has not been built.
>
> The plan was to group them by site, by shift, and **by the skill needed**. But the system has **no record of skills**. Guards are not separated by qualification, grade or certificate.
>
> So there are two options:
>
> - **Leave skills out.** Report by site and shift only. We can do this quickly.
> - **Add skills.** Record what each guard is qualified for, and what each site needs. More useful, but more work — and we would need your list of the skills that actually matter.

**Confirm / Change / Question:** ______________________

---

## 13. The decisions, in one place

**Settled by your review of 15 September 2026:**

| # | What it was | Your answer | Section |
|---|---|---|---|
| 1 | Night rate is off. Is that right? | Yes — no extra pay for nights | 7 |

Three more sections changed in that review, though they were not on this list: shift times
(3), the public holiday rate (6) and allowances (8).

**Needed before the first payroll:**

| # | What we need | Section |
|---|---|---|
| 2 | Union dues and pension — is there a set rule? | 9 |
| 5 | Maternity leave — what does DogForce pay? | 10 |
| — | Section 8 — did you mean no allowances, or a transport **deduction**? | 8 |

**Needed before you go live:**

| # | What we need | Section |
|---|---|---|
| 7 | 240-hour monthly limit — we suggest turning it on | 11 |
| 6 | Limit on how many can be on leave at once — what number, and how strict? | 10 |

**Can come later, but we still need an answer:**

| # | What we need | Section |
|---|---|---|
| 3 | Four-month leave deadline — warn, or refuse? | 10 |
| 4 | Sick and compassionate leave expire, annual leave does not | 10 |
| 8 | Shortage report — with skills, or without? | 12 |

---

## 14. Notes

**This is not legal advice.** Where we mention the law we mean the Labour Act 2007 and the Public Holidays Act 26 of 1990, and this is how we read them when building the system. Items 3 and 4 in particular are matters of interpretation, and a labour lawyer should look at them before you go live.

**Two things the system will never update by itself.** Put both in a diary:

- The minimum wage step to N$18.00 in 2027 (section 2).
- The tax table, whenever it changes in the budget (section 9).

**Keeping track of changes.** Every rule that changes because of this review will be written down — what changed, who decided it, and when — and we will send you an updated version of this document.

| Version | Date | What changed |
|---|---|---|
| 1.3 | 16 September 2026 | Your review of 15 September applied: shift times (3), holiday rate (6), night rate settled (7), allowances (8) |
| 1.2 | 7 September 2026 | Rewritten in plainer language |
| 1.1 | 6 September 2026 | Rates and tax table confirmed; decisions reduced to eight |
| 1.0 | 6 September 2026 | First version |
