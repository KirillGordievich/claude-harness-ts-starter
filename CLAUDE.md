# About
<!-- TODO(project): 3–5 sentences. What the project does, who uses it, what a bug costs, and the stance that follows.
See README.md, "Make it yours", for examples. -->

## Glossary
<!-- TODO(project): the domain's words, as the code spells them. The agent names things with these words. Example:
- **Unit**: a tokenized property share offered for investment (`Unit` model), not a measurement unit. -->

## Architecture
<!-- TODO(project): the layout and the direction of dependencies. Example:
src/
├── app/             # entrypoints: HTTP server, workers, CLIs
├── core/            # business logic: no I/O, talks to the outside through interfaces in core/ports/
└── infrastructure/  # DB, external APIs, queues: implements core/ports/
Dependencies point inward: app → infrastructure → core. -->

## Data flow
<!-- TODO(project): the main path through the system in one line. Example:
`webhook → verify signature → idempotency check → ledger entry → balance update → notification` -->

## Critical paths
<!-- TODO(project): code where a bug costs money, data or access, and what typically breaks there.
The reviewer checks these first. -->

## Invariants
<!-- TODO(project): rules that must hold after every change. Each one ideally has a test. Example:
- Amounts are `Decimal` in minor units, never `number`. -->

## External services
<!-- TODO(project): every API the project talks to: what it is for, sandbox vs production, known quirks,
rate limits. Tests never call a real one. -->

## Environments and commands
<!-- TODO(project): how to run locally, what needs a DB or Docker, what `make check` does NOT cover and how to
run that, where it is deployed and how. -->

## Ask the user before
<!-- TODO(project): decisions the agent never makes alone. Example:
- a change to a public API (route, request or response shape)
- a migration
- anything on a critical path -->

Deeper docs live in `docs/`. Read the one that covers the area before changing it.

# How to Work: goal → plan → loop

1. **Goal.** Restate the task as acceptance criteria that a test or a command can check. If you cannot state them, ask before writing code.
2. **Plan.** A small, obvious change (one place, no design choice): just do it. Anything bigger: run the `/task` skill. It keeps the goal, criteria, steps and assumptions in `plans/tasks/<slug>.md`. One task = one plan file = one branch. The plan file, not the chat, is the source of truth: re-read it after `/clear` or compaction.
   - `plans/tasks/done/`: finished plans, kept as a record of decisions. Not current truth: where one disagrees with the code, the code wins.
   - `plans/BACKLOG.md`: problems found outside the current task. Never widen a task to fix them; add an entry with a trigger and mention it to the user.
3. **Loop.** One small step → the narrowest check that covers it (`./node_modules/.bin/vitest run tests/<x>.test.ts`, `make typecheck`) → read the failure → fix. For a bug: first a failing test that reproduces it, then the fix. Green: tick that step in the plan with Edit right away, one item at a time; a tick means its check passed.
4. **Replan** when a failure disproves an assumption, not for a typo. Add `## Revision N (YYYY-MM-DD): what failed, what it showed, what changes` to the plan file and rewrite the remaining steps. Never delete earlier revisions.
5. **Finish** only at the Definition of Done. For a non-trivial task, run the `reviewer` subagent on the diff first and fix what it finds.

## Reading code
Everything read stays in context and is re-read on every later turn, so read only what the step needs.
- Locate with Grep (a narrow path), then Read with `offset`/`limit` around the hit. Read a whole file only when the step needs the whole file.
- Broad exploration ("how does X work", "where is Y used") goes to the `Explore` subagent: it returns a summary instead of the files.

## Definition of Done
- `make check` is green: TypeScript, Oxlint (type-aware), ESLint (the rules Oxlint lacks) with Prettier, Vitest, and the tests of the hooks. It is the single source of truth, and the stop gate runs it.
- Every acceptance criterion is checked off in the plan file and covered by a test.
- The diff adds no `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`, `as any`, `.skip`/`.only` and deletes or weakens no test, unless the user approved it.
- The final message says what changed, how it was verified, and what is left or risky. If something is not done, say so first.

## Guardrails (enforced by `.claude/hooks/`, do not work around them)
Project specifics (secret files, migration and data dirs, dangerous commands) are in `.claude/harness.json`.
- **Change files with Edit, create them with Write.** Never write project files through the shell (`>`, `>>`, `tee`, heredoc): only Edit/Write go through the path checks and the lint hook, and only they show the user a diff. Exception: one mechanical replacement across many files may use `sed -i`, followed by `make check`.
- `guard.mjs` blocks: reading or writing secret files (`.env*` except `.env.example`, `secrets/`, keys); editing or deleting an existing migration; writing or deleting `data/`; the commands in `blockedCommands` (force push, `reset --hard`, DB resets); shell writes into project code; `sed -i` on a single code file, and on migrations, data or `plans/` at all. It asks the user before a direct database write (`psql ... DROP`).
- `post_edit.mjs` runs Oxlint (type-aware, ~0.2 s) and a Prettier check on every edited file and reports problems right away; a problem already reported is only counted. Not formatted: run `./node_modules/.bin/prettier --write <file>`, then Read the file before the next Edit. The full ESLint runs only in `make check`.
- `stop_gate.mjs` runs `make check` when you try to finish with code changes. Red: you keep working. After 3 red attempts you must stop and report to the user instead. Green but the diff adds suppressions or removes tests: remove them or justify each one to the user. A changed plan with `Status: done` and unticked items: tick what is verified, or reopen it.

If a guard blocks something you really need, stop and ask the user. Never route around it with another tool, a copy or a rename.

# Project Rules

## Runtime
- Node 22 (`.nvmrc`), TypeScript strict, ES modules, `pnpm`.
- Run tools as `./node_modules/.bin/<tool>` or through `make`, not `pnpm exec`: without a TTY pnpm may try to reinstall `node_modules`.

## Conventions
- **Names say what the code does, in plain words.** A reader must understand a function or variable without opening it. Prefer the domain's own words over metaphors; if a name needs a comment to explain it, rename it.
- Explicit return types on exported functions; no `any` (use `unknown` and narrow it).
- No magic numbers: named constants or config.
- Keep functions short and focused; extract helpers when > 30 lines.
- **No silent fallback values for external data.** If an API field is missing or `null`, propagate it or return an error; never substitute a default. Fallbacks only when explicitly requested, with the reason in a comment.
- **`undefined`/`null` for "absent", not sentinel numbers** (`0`, `-1`, `Infinity`).
- Config from environment variables, validated at startup; every new variable also goes to `.env.example`.
<!-- TODO(project): framework rules (DI, DTOs, logging library, error format). -->

## Testing
- While working: the narrowest run, `./node_modules/.bin/vitest run tests/<x>.test.ts`. At the end: `make check`.
- A bug gets a failing test that reproduces it before the fix.
- Time-based tests use fixed timestamps (`vi.setSystemTime`), not the real clock.
- No mocking of internal modules: test through public interfaces; stub only external services.
- Never skip, weaken or delete a failing test to get green. If you believe the test is wrong, explain why and ask.

## Database migrations
<!-- TODO(project): the migration tool and its commands; keep `immutableDirs` in .claude/harness.json in sync. -->
- All schema changes go through a new migration; never edit an existing one (it may already be applied in production).
- Apps never run migrations on startup; they run in the deploy.

## Git
- Work on a branch: `feat/<slug>`, `fix/<slug>`; commit only when the user asks.
- Commit messages: `feat(scope):`, `fix(scope):`, `chore:`, `docs:` prefixes.
- Never commit `.env`, data or any secret file.
