# Security payroll UAT — 20 Aug 2026 — decisions

**Project:** security-payroll-demo
**Decision set:** `secpay-uat-2026-08-20` (`55f8b31d-93cb-4b13-b5a6-63152d095aba`)
**Questions from:** `uat/2026-08-20/UAT.md`
**Decided by:** Philip, in conversation with THE KEEPER, 28–30 Aug 2026
**Exported:** 2026-08-30, from Keeper's live Supabase (`keeper_decisions` + `keeper_decision_history` + the conversation archive)

> **Read this before implementing anything.**
>
> Keeper's decision queue drifted: from `D-05` onward the agent improvised its own
> follow-up questions but saved the answers against the *next unanswered UAT ref*.
> The stored `question` text and the stored `answer` therefore describe different
> things on 13 of 21 rows. A straight dump of the table is actively misleading.
>
> This brief is reconstructed from the conversation transcript, which is the
> authoritative record of what was actually asked and answered. Every item below
> is paired with the question Philip really saw. Section 3 lists the UAT questions
> that were **never asked** — they are still open, regardless of what the database
> row says.

**Coverage:** 8 UAT questions decided · 14 additional payroll-workflow decisions · 13 UAT questions still open

---

## 1. Decided — answers to the original UAT questions

### UAT-01 / D-01 — Sunday boundary rule *(critical)*

**Question:** Which rule governs a shift that crosses midnight into or out of Sunday?

**Decision:** Do not hardcode an interpretation. The Sunday boundary rule is
**configuration**, so either reading is a settings change rather than a rewrite.
The applicable rule is still the client's and labour counsel's to confirm.

**Why:** An exact 6/6 split across midnight is ambiguous and the Labour Act appears
to use a majority-of-shift test. Encoding one reading risks encoding the wrong law.

### UAT-01 / D-02 — Tied shifts *(critical)*

**Question:** For a tied shift (equal hours either side of midnight), which side wins?

**Decision:** No separate tie-breaker. The configured boundary rule (midnight split,
as currently selected) already resolves it.

### UAT-02 / D-03 — Proof of the 1.5× arrangement *(critical)*

**Question:** What counts as proof that the 1.5× Sunday arrangement is validly in place?

**Decision:** **Standing signed consent in the employment contract is sufficient.**
No separate per-Sunday consent prompt and no per-occasion employee choice.

**Why:** The client's existing arrangement already carries the agreement in the
employment contract; employees are not offered a fresh choice each Sunday.

### UAT-02 / D-04 — Missing consent or records *(critical)*

**Question:** If the consent or comp-rest record is missing, does payroll hard-block
or allow an authorised exception?

**Decision:** **Block the rate, not the run.** Where valid contract consent or the
required records are missing, invalid or unmigrated, do not apply 1.5× — fall back
to **2×**, let payroll continue, and show the reason in the calculation breakdown
and audit trail. Never silently grant 1.5× without its basis.

### Client decision 4 / D-09 — Stricter hour and rest limits *(critical)*

**Question:** Are there stricter company or contract limits beyond the current
60-hour week and six-workday rule?

**Decision:** **The current rules are complete. Do NOT add a minimum rest-gap rule
(no 11-hour gap).** The existing weekly-hour cap, weekly rest, six-workday rule and
night/day conflict checks stand as they are.

> ⚠️ **The database row for D-09 is wrong.** It stores *"Add a minimum rest gap
> between shifts, such as 11 hours."* Keeper misread a bare "1" as choosing the
> second option; Philip corrected it explicitly at 15:53 on 28 Aug
> (*"1. Current rules are complete. Is what I meant."*) and the correction was
> never persisted. **The correction above is authoritative.**

### UAT-07 / D-08 — Premium cap enforcement *(high)*

**Question:** Once a guard has reached the premium cap, is the cap a hard block or a
strong de-prioritisation in the ranking?

**Decision:** **Hard block, overridable only through a senior exception workflow**
with a recorded reason and full audit trail.

**Why:** The cap stays a real refusal, while a genuine operational emergency can
still cover a site — visibly, and on the record.

> The database currently has D-08 reopened as `unresolved`. That reopening was a
> precaution taken while the mismatch was being diagnosed. The stored question and
> the stored answer **do match** here — treat it as decided.

### UAT-14 / D-15 — Leave capacity rule *(high)*

**Question:** The maximum-10-on-leave rule: tenant-wide or per-site, and does it
count people or leave-days?

**Decision:** **Both.** Enforce the tenant-wide maximum of 10 employees on annual
leave in a month *and* run a per-site, day-level coverage check.

**Why:** Ten people off is harmless if they are spread across sites; three off at
one site on one day is not.

> As with D-08, this row is currently reopened as `unresolved` in the database as a
> diagnostic precaution. Question and answer match — treat it as decided.

### UAT-15 / D-19 — Leave forfeiture *(critical)*

**Question:** Confirm the system will never auto-forfeit or auto-cash-out annual leave.

**Decision:** **Never automatic.** Expiry and cash-out of annual leave require a
manual, evidenced decision. No scheduler date may trigger either action.

*(Stored in the database as the bare string `"1"` — expanded here from the question
Philip was answering.)*

---

## 2. Decided — payroll workflow rules with no UAT ref

These 14 decisions are real and were properly considered, but they answer questions
Keeper invented during the session rather than anything in `UAT.md`. They were
written into the `D-05`–`D-21` rows whose stored questions describe something else
entirely. **Implement these on their own terms; ignore the D-numbers they are
currently filed under.** They need new refs in the source UAT before the next round.

| Ref | Area | Decision | Recorded as |
| --- | --- | --- | --- |
| P-01 | Sunday rate basis | For an employee on a fixed monthly salary, payroll **enters the Sunday base rate manually each pay period** (rather than deriving it from salary ÷ ordinary monthly hours, or a configurable divisor). | D-05 |
| P-02 | Rate validation | Validate the manually entered Sunday base rate against the employee's calculated ordinary rate and **warn when it differs**. Do not block submission on the difference alone. | D-06 |
| P-03 | Acknowledgement | Where the warning fires, **an authorised user must acknowledge it before payroll can be submitted.** Log user, timestamp, the values acknowledged, and the validation result. Unauthorised users cannot acknowledge on payroll's behalf. | D-07 |
| P-04 | Roster | **Keep the existing one-shift-per-employee-per-calendar-date rule.** Do not introduce a multiple-shift exception as part of this work. | D-10 |
| P-05 | Midnight crossing | A shift crossing midnight stays **one stored roster record** with its actual start/end timestamps. The backend splits it into **calculation segments at midnight**; the roster is never split into two shifts. | D-11 |
| P-06 | Segment visibility | **Expose those segments** in the payroll breakdown and the audit trail, while the roster continues to show one shift. | D-12 |
| P-07 | Warning timing | Show the rate-difference warning **both when the rate is entered and again at payroll submission.** | D-13 |
| P-08 | Acknowledgement scope | An acknowledgement applies to **the current payroll submission only** — not the whole pay period, and not until the rate next changes. | D-14 |
| P-09 | Acknowledgement reason | A reason/comment on the acknowledgement is **optional, but recorded when provided.** | *(never persisted — see §4)* |
| P-10 | Re-acknowledgement | Changing the Sunday base rate **invalidates the previous acknowledgement** and requires a new one. The approval is tied to the exact values reviewed. | D-16 |
| P-11 | Clean validation | When the entered rate **matches** the ordinary rate, **record that validation passed but require no acknowledgement.** | D-17 |
| P-12 | Approval depth | The authorised acknowledgement is **sufficient for submission**; no additional senior approval step. | D-18 |
| P-13 | Leave expiry | When annual leave reaches its expiry threshold, **flag it as expired, preserve the record, and leave any further action to a manual client decision.** | D-20 |
| P-14 | Expired balance | Move expired leave into a **separate expired-leave balance** that stays visible for audit and possible manual resolution — not removed, and not left looking bookable. | D-21 |

---

## 3. Still open — UAT questions that were never actually asked

Their database rows look answered. They are not: the answer sitting in each row
belongs to a P-item in §2. **Do not implement a default, do not infer a rule, and do
not read the stored answer as permission.**

| Ref | Area | Priority | The question that still needs answering |
| --- | --- | --- | --- |
| D-05 | Sunday eligibility | High | Which Sunday work categories must the system distinguish (rostered / relief-and-call-in / public holiday)? |
| D-06 | Fair allocation | High | What exactly counts as a "premium opportunity" for the fairness cap? |
| D-07 | Premium cap | High | What is the cap, over what window, and is the window fixed or a tenant setting? |
| D-10 | Emergency exceptions | High | May a compliance block ever be overridden, and by whom? (Keeper's steer: fairness caps overridable by a senior role with reason and audit; statutory hour and rest limits never.) |
| D-11 | No-candidate response | Critical | When nobody is compliant, what does the system do and show? |
| D-12 | Shortage register | High | What does the shortage register capture, and who receives the weekly report? |
| D-13 | Recruitment scope | Low | Phase one: shortage reporting only, or also an applicant pipeline? |
| D-14 | Leave cycles | Critical | What anchors each employee's annual leave cycle, and is that date already in the system? |
| D-16 | Leave conflict | Critical | When the capacity cap collides with an employee's statutory leave deadline, what happens? |
| D-17 | Directed leave evidence | High | What is the acceptable evidence standard for instructed leave and for employee refusal? |
| D-18 | Leave planner | High | How far ahead does the leave planner warn, and who sees it? |
| D-20 | Premium reporting | Medium | What does the management premium/Sunday report need to show? |
| D-21 | Sequencing | High | With the Sunday-pay rule still held with the client, what should the build tackle first? |

Four of these (D-05, D-06, D-07, D-13) are also on the client/legal list in
`UAT.md` — they are not Philip's alone to settle.

---

## 4. Data-integrity notes for whoever fixes the queue

1. **D-09 holds a wrong answer.** Stored: add an 11-hour rest gap. Actual: current
   rules are complete. Correct it through `keeper_decision_history` with a revision
   note; do not delete the original.
2. **P-09 was lost entirely.** On 29 Aug at 19:38 Keeper replied *"saved — D-15: make
   the reason optional, but record it when provided"* and decremented the counter,
   but no row and no history entry were ever written. The next day the D-15 row was
   reused for the leave-capacity question. The optional-reason decision exists only
   in the transcript.
3. **D-08 and D-15 were reopened as `unresolved` in error** on 30 Aug at 15:01. Both
   are among the few rows where question and answer genuinely agree.
4. **The status vocabulary diverged from the schema.** `009_decisions.sql` defines
   `open | answered | deferred | needs_client | needs_legal`; the live rows use
   `confirmed` and `unresolved`. `renderBriefMarkdown` keys off `status === 'answered'`,
   so the built-in exporter currently files **all 21 rows** under
   *"Not actionable — DO NOT IMPLEMENT"*. That is why this export was written by hand.
5. **Root cause of the drift:** `answer_decision` trusted the ref the agent supplied
   instead of the ref of the question it had just read out. Nothing forced the answer
   back onto the question that produced it. Any fix should bind the two together —
   e.g. the tool answers "the decision I last read", or the question text is echoed
   back and checked before the write.

---

## Suggested order of work

1. **P-05 / P-06** — the midnight segmentation engine. Pure, testable, and everything
   Sunday-related sits on top of it.
2. **D-01 / D-02** — configurable Sunday boundary mode, on top of that engine.
3. **P-01 → P-03, P-07, P-08, P-10 → P-12** — the manual Sunday rate entry,
   validation, warning and acknowledgement flow, as one coherent batch.
4. **D-03 / D-04** — 1.5× consent check with the 2× fallback.
5. **P-04, D-09** — confirm the existing roster rules still hold; add nothing.
6. **D-08, D-15** — premium cap hard block with senior override; leave capacity with
   per-site day-level coverage.
7. **D-19, P-13, P-14** — leave expiry handling, all manual, all auditable.

Everything in §3 stops here until Philip and the client answer it.
