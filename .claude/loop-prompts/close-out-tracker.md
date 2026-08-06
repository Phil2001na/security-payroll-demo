# Loop: close out security-payroll-demo tracker (all except #3 leave module)

Project: `C:\Users\phili\OneDrive\Documents\projects\security-payroll-demo`

## Goal
Work `tracker.html`'s `ISSUES` array down to `verdict: 'pass'` for every issue **except id 3**
(the leave management module — explicitly out of scope for this loop; leave its verdict
untouched no matter what it currently says). Keep looping — write, fix, verify, repeat — until
that's true, then stop.

## Each iteration
1. Read `tracker.html`'s `ISSUES` array fresh (don't trust memory from a prior iteration —
   another process or Philip may have touched it). Find the first issue, in id order, where
   `id !== 3` and `verdict !== 'pass'`.
2. If there is none: every non-leave issue is `pass`. Update the header subtitle to say so,
   append a closing entry to `UPDATES.md`, call `ScheduleWakeup` with `stop: true`, and tell
   Philip it's done — id, title, and one line per issue of what got fixed. Stop here.
3. Otherwise, route that issue through whichever of the three skills fits its actual state —
   don't run all three on every issue, and don't skip straight to the one that sounds most
   satisfying:
   - **`/fix-tracker`** only if the issue's own text is stale or wrong relative to the current
     code (e.g. it describes a bug that's already fixed, or is missing a card for something
     new) — this skill re-seeds cards, it doesn't fix code or verify anything.
   - **`/apply-fixes`** if the card's `verdict` is `fail`, or a prior `/verify-tracker` audit
     left a concrete code-level finding (like #6's management-exclusion bug this session) —
     this is the only skill allowed to touch application code, and it should ask before each
     change per its own rules.
   - **`/verify-tracker <id>`** if the code looks done (`fix` field says "Done" / similar) but
     the `verdict` is `untested` or `partial` — drive the browser, confirm real behavior, write
     the verdict back.
   Most issues will need `/apply-fixes` then `/verify-tracker` in sequence across two
   iterations — that's expected, don't force both into one pass.
4. **Decisions only Philip can make** (not implementation, not testable by browser): if an
   issue's own text says it needs a business/product call before it can be verified as done —
   e.g. #7's `monthly_cap_enforced` flag (flipping it changes how the client rosters, per that
   card's own note), or #13 which isn't built at all and needs scope agreed — ask via
   `AskUserQuestion` once, record the answer in the card's `note`/`audit` field, then proceed
   on that basis for the rest of the loop. Don't re-ask on a later iteration once answered.
   Don't guess an answer to spare yourself the question.
5. Log what happened this iteration to `UPDATES.md` (new entry, this project's existing
   `## YYYY-MM-DD HH:MM` convention, newest on top) and to a running scratch file at
   `<scratchpad>/verify-tracker/loop-progress.md` — append, don't overwrite, so a fresh
   iteration (or a fresh session if this one's context resets) can see what already happened
   without re-deriving it.

## Browser tooling failures — wait and retry, don't give up
If `/verify-tracker` reports the Chrome extension is down (permission errors, unresponsive
tools, the "hard lesson" failure mode its own instructions describe) rather than a real test
result:
- Do **not** mark the issue `fail` or invent a verdict.
- Do **not** retry immediately in a loop — that's the exact failure mode `/verify-tracker`
  warns against.
- Write what happened to `loop-progress.md`, leave the issue's verdict as it was, and call
  `ScheduleWakeup` with `delaySeconds: 600`, `reason: "browser tooling was down, retrying
  verify-tracker on issue #<id>"`, and `prompt` set to this same loop prompt (paste it back in
  full, verbatim — the next firing needs to be self-contained) so the loop resumes and retries
  that issue instead of moving on or stopping.

## Standing constraints (carry these into every iteration, they don't get re-asked)
- All employee/disciplinary/attendance test data in this tenant is test data — Philip has
  said this explicitly and it's fine to create/modify freely for verification.
- Schema changes (migrations, new constraints, new functions) are a different category from
  test data — treat them with real caution per this project's own CLAUDE.md, but they are not
  blanket-prohibited: Round 6 already applied 3 pending migrations plus compatibility shims
  with Philip's up-front approval for "apply all 3." If a new migration or schema change comes
  up that goes beyond what's already been approved, ask before applying it, the same way Round
  6 did.
- If `/apply-fixes` finds a fix touches something outside the flagged issue's own scope, don't
  quietly expand scope — surface it and keep going on the current issue.
- Never mark `partial` or `untested` up to `pass` to close the loop faster. A false pass here
  is worse than a slower loop.

## Stop conditions
- **Success**: every issue except id 3 is `verdict: 'pass'` — stop per step 2 above.
- **Genuinely stuck**: the same issue fails to make progress across 3 consecutive iterations
  for a reason that isn't a browser-tooling outage (e.g. a fix keeps breaking something else,
  or a decision from Philip is still pending after asking) — stop the loop (`ScheduleWakeup`
  with `stop: true`), and report exactly what's blocking it. Don't spin indefinitely on a
  problem that isn't converging.
