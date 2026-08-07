# Loop: close out security-payroll-demo tracker round 2 — #12, #10, #3 only

Project: `C:\Users\phili\OneDrive\Documents\projects\security-payroll-demo`

## Goal
Work `tracker.html`'s `ISSUES` array down to `verdict: 'pass'` for ids **12, 10, and 3 only**.
Every other issue is out of scope for this loop — don't touch their verdicts even if you notice
something (#7 is intentionally left partial: enforcement applied, hard-block-firing not yet
observed live, and that's fine; #13 needs client scope, not this loop's job). Keep looping —
write, fix, verify, repeat — until all three targets are `pass`, then stop.

## Known state going in (from the prior round's scratch notes, don't re-derive)
- **#12** — disciplinary chain's payroll-effect leg. Not a code bug: blocked on a pay period
  having confirmed attendance data to test against. First move should be creating that test data
  (test data in this tenant is freely creatable, see standing constraints) rather than assuming
  code needs fixing.
- **#10** — Sunday call-in payslip line. Code marked "Done" as of the fix that landed it — this
  is a `/verify-tracker 10` re-check, not an `/apply-fixes` job, unless verification finds a real
  bug.
- **#3** — leave management module. Was explicitly excluded from the prior loop; nobody has run
  a browser UAT pass on it yet. Treat it as needing a full `/verify-tracker 3` pass first to find
  out what state it's actually in — don't assume it's broken or done.

## Each iteration
1. Read `tracker.html`'s `ISSUES` array fresh (don't trust memory from a prior iteration).
   Find the first issue, in order [12, 10, 3], where `verdict !== 'pass'`.
2. If there is none: all three are `pass`. Update the header subtitle, append a closing entry to
   `UPDATES.md`, call `ScheduleWakeup` with `stop: true`, and tell Philip it's done — id, title,
   one line per issue on what got fixed/confirmed. Stop here.
3. Otherwise, route that issue through whichever skill fits its actual current state — don't run
   all three on every issue:
   - **`/fix-tracker`** only if the card's own text is stale relative to current code.
   - **`/apply-fixes`** if `verdict` is `fail`, or a `/verify-tracker` audit left a concrete
     code-level finding — the only skill allowed to touch application code; it asks before each
     change per its own rules.
   - **`/verify-tracker <id>`** if the code looks done but `verdict` is `untested`/`partial` —
     drive the browser, confirm real behavior, write the verdict back.
   Expect most issues need `/apply-fixes` then `/verify-tracker` across two iterations — that's
   normal, don't force both into one pass.
4. **Decisions only Philip can make**: if progress on #12/#10/#3 surfaces a genuine business or
   product decision (not implementation, not testable by browser), ask via `AskUserQuestion`
   once, record the answer in the card's `note`/`audit` field, then proceed — don't re-ask later,
   don't guess to avoid asking.
5. Log what happened this iteration to `UPDATES.md` (existing `## YYYY-MM-DD HH:MM` convention,
   newest on top) and append to `<scratchpad>/verify-tracker/loop-progress.md` so a fresh
   iteration or session can pick up without re-deriving state.

## Browser tooling failures — wait and retry, don't give up
If `/verify-tracker` reports the Chrome extension is actually down (not a real test result):
do not mark the issue `fail` or invent a verdict; do not retry immediately. Write what happened
to `loop-progress.md`, leave the verdict as-is, call `ScheduleWakeup` with `delaySeconds: 600`,
`reason: "browser tooling was down, retrying verify-tracker on issue #<id>"`, and `prompt` set to
this same loop prompt pasted back in full so the loop resumes and retries instead of moving on.

## Standing constraints (carried over from round 1, still apply)
- All employee/disciplinary/attendance test data in this tenant is test data — free to
  create/modify for verification.
- Schema changes are a different category from test data — real caution per this project's
  CLAUDE.md, not blanket-prohibited; ask before applying anything beyond what's already been
  approved in prior rounds.
- If a fix touches something outside the flagged issue's scope, surface it, don't quietly expand.
- Never mark `partial`/`untested` up to `pass` to close the loop faster.
- Entering credentials into a login field is not something you do yourself — if a step needs a
  sign-in that requires typing a password, stop and ask Philip to do that specific step (see
  round 1's #8 handling), don't retry against the safety classifier.

## Stop conditions
- **Success**: #12, #10, #3 all `verdict: 'pass'` — stop per step 2.
- **Genuinely stuck**: the same issue fails to make progress across 3 consecutive iterations for
  a reason that isn't a browser-tooling outage — stop the loop, report exactly what's blocking it.
