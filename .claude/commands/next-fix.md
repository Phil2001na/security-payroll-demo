---
description: Implement the next outstanding item from tracker.html, end to end, one item per run.
---

# /next-fix — work the tracker down

Take **one** outstanding item from `tracker.html`, implement it properly, and leave the repo in a
state Philip can verify. One item per run. Do not batch, do not "while I'm here" into a second card.

**Definition of done for the whole backlog:** every card in `tracker.html` reads
`Built — verify`, and Philip has passed them in a feedback round. You are not done because the
code compiles; you are done when there's nothing left to hand him.

## 1. Pick the item

In this order:

1. Anything ❌ **Failed** in the newest file in `feedback/` — his note says what's still wrong.
2. Otherwise the **topmost card in `tracker.html` whose `priorityLabel` starts with neither
   "Built" nor "Blocked"**. A `Blocked` card is waiting on a decision from Philip or the client —
   skip it and move down; don't re-litigate it every run.

Say which item you picked and why, in one line, before you start.

## 2. Read before you write

- The card's `plan` field is the **agreed architecture** — it was written after reading the code,
  and it exists because the raw UAT wording was often wrong about what the system actually does.
  Follow it.
- If implementing proves the plan wrong (the schema isn't what it assumed, the cheap signal
  doesn't exist, the change breaks something else) — **stop and report**. Don't improvise a
  different design and ship it. A wrong turn here is more expensive than a paused run.
- Check `CLAUDE.md`, `supabase/schema-baseline-2026-07-05.sql` (live schema truth, the migrations
  folder has drifted) and the actual route/lib files before deciding anything.

## 3. Build it

- Match surrounding style. Comments explain *why*, not what.
- Shared rules go in `src/lib/`, not copy-pasted into two routes — several of these cards exist
  because the same rule was expressed in two places and drifted.
- `bunx tsc --noEmit` and `bun run build` must both pass. Lint the files you touched and ignore
  the repo-wide CRLF/prettier noise.
- Where the change affects money (payroll engine, deductions, allowances, multipliers): compute
  the before/after for at least one real employee in a real period and put both numbers in your
  report. A silent N$40 difference is the failure mode that matters here.

## 4. Database changes — the hard rule

Write the migration to `supabase/migrations/`. **Do not `supabase db push` without Philip saying
go, in this session, for this migration.** This project has real tenant data.

When you do have the go-ahead:
- push, then verify the object exists and behaves (impersonated JWT per role, in a transaction you
  `rollback`, as done on 2026-07-19),
- run `get_advisors` and report anything new,
- regenerate `src/integrations/supabase/types.ts`.

## 5. Close the loop

- Append to `UPDATES.md` (newest first, `### HH:MM - what changed`), factual and brief.
- Update the card in `tracker.html`: `priorityLabel` → `Built — verify`, rewrite `steps`/`pass`/
  `fail` to match what actually shipped (a tester follows these literally — name the real buttons),
  replace `plan` with `note` explaining how it was built and where it differs from the original
  idea. Regenerate via `/fix-tracker` so the template stays the source of truth.
- Report: what you built, the verification steps, anything you deliberately left out, and whether
  a migration is waiting for approval.

## 6. Stop and ask — don't push through

Halt the run and report instead of guessing when:

- **The card needs a client decision.** #10 needs the client's definition of an "unplanned"
  Sunday shift; #13 (patrols) needs scope and whether it's worth a phone-first build. Don't
  invent an answer — the wrong one gets built and then lived with.
- The plan turns out not to fit the code (see §2).
- A change would alter what an already-finalized payroll period paid.
- The build fails for a reason you can't attribute to your own change.
- You'd be pushing a second migration to prod in the same run.

Being blocked and saying so is a successful run. Shipping a guess is not.
