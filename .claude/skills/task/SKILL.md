---
name: task
description: Run a development task end to end in this repo, goal → acceptance criteria → user approval → plan file → implement in a check loop → replan when an assumption breaks → finish only when make check is green. Use for any feature, fix or refactor bigger than a one-place change, or when the user types /task.
---

# Task workflow

The argument is the task: a description, an issue id, the slug of an active `plans/tasks/<slug>.md` to resume, or an entry of `plans/BACKLOG.md`.

Where plans live:
- `plans/tasks/*.md`: active tasks. Only these are resumed. The slug is the issue id in lower case, or a short kebab-case name.
- `plans/tasks/done/`: finished tasks, a record of decisions. Not current truth: where it disagrees with the code, the code wins. Read it only to learn why something was done the way it was.
- `plans/BACKLOG.md`: problems found along the way and not done yet, each with a trigger.

## 1. Goal and plan
- Existing plan file: read it, find the first unchecked step and the latest revision, continue from there. Status `planned` means it was never approved: go to Approval.
- Backlog entry: re-check it against the current code (it may be stale), draft a plan from it; after approval remove the entry from `plans/BACKLOG.md`; the plan's Origin links to where it came from.
- New task: read the code and the `docs/` page that covers the area, draft Goal, Acceptance criteria, Assumptions, Plan.
- Criteria must be checkable by a test or a command. Ask the user before coding when they are unclear, or for a choice the code cannot settle: a public interface (API route, request or response shape), a migration, permissions, anything on a critical path listed in CLAUDE.md.

**Approval.** Present the draft (goal, criteria, steps, open questions) and stop: no branch, no plan file, no code until the user approves, unless they said not to wait. Then:
- Create the branch `feat/<slug>` or `fix/<slug>` from the current branch if you are not on one already.
- Write the approved plan: copy `plans/tasks/_TEMPLATE.md` to `plans/tasks/<slug>.md` (or update the existing one), Status `in progress`, the user's answers in `## Decisions`.
- A later change of Goal or Acceptance criteria needs approval again. A change of steps does not: it is a Revision.

## 2. Loop
For each step of the plan:
1. Write the test for the step first when it adds or fixes behaviour; run it and see it fail for the right reason.
2. Make the smallest change that makes it pass.
3. Run the narrowest check: `./node_modules/.bin/vitest run tests/<x>.test.ts`, then `make typecheck` for typed changes.
4. Green: tick that one step in the plan file with Edit, right away. Red: read the whole failure before changing anything.

A tick is evidence, not bookkeeping: it means "this step's check was green". Tick one item per Edit, at the moment its check passes; never tick in bulk (`sed -i` on `plans/` is blocked).

Big task: the plan file holds the state, so a fresh session loses nothing. You cannot run `/clear` yourself; the user decides. At a phase boundary (e.g. after implementation, before review) or once the context passes ~150k: make sure the plan file is current (ticks, revisions, next step), then tell the user it is a good moment for `/clear` and `/task <slug>`, and go on unless they take it.

## 3. Replan
Decide what the failure means:
- **Slip** (typo, wrong import, a missed case in your own code): fix it, no revision.
- **Disproven assumption** (an API returns something else, the existing code behaves differently, a criterion conflicts with another rule): add a `## Revision N` to the plan file (failed / showed / changed), rewrite the remaining steps, then continue.
- **Same step red three times**, or the fix needs a decision from the list in step 1: set Status `blocked`, write what you know into the plan file, ask the user.

**Found something outside this task** (another bug, a design limit, a follow-up): do not fix it here, the task's scope stays fixed. Add an entry to `plans/BACKLOG.md` with What / Why not now / Trigger / Context, and mention it in the final message. A deliberate trade-off inside this task goes to the plan's `## Decisions` instead.

## 4. Finish
1. `make check`. The stop gate runs it too and will not let you finish while it is red.
2. Run the `reviewer` subagent on the diff, with the plan file path; fix what it finds or explain why not. A finding that changes an acceptance criterion or the approach is a Revision (and a criterion change goes back to Approval); a plain fix is not.
3. Tick each acceptance criterion whose test is green now, after the reviewer fixes, one Edit each. Fill in Result. Set Status `done` only if nothing is left unticked; otherwise `in progress` or `blocked` with what is left. The stop gate rejects `done` with unticked items.
4. Status `done`: move the plan to the archive with `git mv plans/tasks/<slug>.md plans/tasks/done/`. Anything left over is already in `plans/BACKLOG.md`, not only in Result.
5. Final message: what changed, how it was verified, what is left or risky, backlog entries added, and any approved exceptions (eslint-disable / oxlint-disable, skips). Do not commit unless the user asks.
