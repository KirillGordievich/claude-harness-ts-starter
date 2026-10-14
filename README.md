# node-js-app-template

A Node.js + TypeScript starter with a Claude Code harness. The agent works in a goal → plan → check loop, and
hooks stop it from finishing with red checks, from touching secrets and from editing applied migrations.

The harness is generic. What makes the agent good in **your** project is what you tell it about the project:
the domain, what a bug costs there, and the rules that hold nowhere else. Most of this README is about that
part: [Make it yours](#make-it-yours).

Stack: Node 22, TypeScript 6 (strict), pnpm, Oxlint (type-aware) + ESLint 10 (typescript-eslint strict) + Prettier, Vitest.

**Two linters, on purpose.** Oxlint (Rust, type-aware through `oxlint-tsgolint`) lints each file the agent edits
in ~0.2 s, where type-checked ESLint took ~1.4 s here and ~6 s in a large NestJS project: the agent gets feedback
after every Edit. ESLint runs only in `make check`, for the rules Oxlint does not have yet; `eslint-plugin-oxlint`
turns off in ESLint every rule `.oxlintrc.json` already covers, so each problem is reported once. When Oxlint covers
all you need, drop ESLint: remove it from `make lint` and `eslint.config.mjs`.

TypeScript is held at 6.0: typescript-eslint does not support TypeScript 7 yet. `eslint-plugin-oxlint` pins the
Oxlint minor version (`~1.87`): upgrade the two together.

## Start a new project from it

```bash
cp -r node-js-app-template my-app && cd my-app && rm -rf .git node_modules && git init
pnpm install
make check        # must be green before the first change
```

Then work through [Make it yours](#make-it-yours). Every place to fill in is marked `TODO(project)`:
`grep -rn "TODO(project)" CLAUDE.md .claude`.

---

## Make it yours

Fill in this order. **Day 1** is what the agent needs to avoid expensive mistakes; the rest you add as the
project grows, best right after the agent got something wrong (see [Keep it alive](#keep-it-alive)).

| # | What | Where | When |
|---|---|---|---|
| 1 | About: what the project is and what a bug costs | `CLAUDE.md` › About | Day 1 |
| 2 | Critical paths | `CLAUDE.md` › Critical paths | Day 1 |
| 3 | Invariants | `CLAUDE.md` › Invariants | Day 1 |
| 4 | Ask the user before | `CLAUDE.md` › Ask the user before | Day 1 |
| 5 | Secrets, migrations, data, dangerous commands | `.claude/harness.json` | Day 1 |
| 6 | What "done" means: `make check` | `Makefile` | Day 1 |
| 7 | Glossary | `CLAUDE.md` › Glossary | First week |
| 8 | Architecture and data flow | `CLAUDE.md` › Architecture, Data flow | When the layout settles |
| 9 | External services | `CLAUDE.md` › External services | With each integration |
| 10 | Environments and commands | `CLAUDE.md` › Environments and commands | When there is a DB / Docker / deploy |
| 11 | Framework conventions | `CLAUDE.md` › Conventions | When the first pattern repeats |
| 12 | Team workflow: tracker, branches, extra done-steps | `CLAUDE.md` › Git, `/task` skill | When there is a team |
| 13 | Domain checks of the reviewer | `.claude/agents/reviewer.md` | After the first review that missed something |

The examples below use three kinds of projects, so you can find the one closest to yours:
**Tokenization**: a platform that sells real-estate shares as tokens. **Trading bot**: a bot that trades
weather markets on Polymarket. **Exchange**: the backend of a crypto exchange service (swap one coin for another).

### 1. About

3–5 sentences: what the project does, who uses it, **what a bug costs**, and the stance that follows from it.
The cost is the most important line: it decides whether the agent may move fast or must stop and ask.

> **Tokenization.** Backend of a platform that tokenizes real estate: investors buy shares (units) of a property
> and get payouts. Users are investors, property owners and admins with different roles. A bug can show one
> investor's data to another, or book an investment that was not paid. Access and money code: correctness over speed.

> **Trading bot.** Bot that trades weather markets on Polymarket: forecast → probability per temperature bin →
> compare with the market price → order through the CLOB API. Runs unattended, one loop per city.
> **It trades real money.** A bug in signal, order or position code loses money: when unsure, stop and ask.

> **Exchange.** Backend of a crypto exchange service: a user gets a quote, sends coin A to a deposit address,
> and receives coin B. Holds user funds in hot wallets between deposit and payout. A bug pays out twice, pays the
> wrong address, or loses a deposit. Nothing that moves funds is changed without a test and the user's approval.

### 2. Critical paths

The code where a bug costs money, data or access, and **what typically breaks there**. The reviewer checks these
first; the `/task` skill asks you before touching them.

| Project | Critical path | What breaks |
|---|---|---|
| Tokenization | investments, payments, payouts | paid but not booked, booked twice, rounding of share prices |
| Tokenization | auth, roles, permissions | a Default user sees another user's units; guard order on an endpoint |
| Trading bot | signal → order → position | off-by-one in temperature bins, °F vs °C, trading-day boundary in the city's time zone |
| Trading bot | order placement | a retry after a timeout places the same order twice |
| Exchange | deposit detection | crediting before enough confirmations; a reorg; the same tx credited twice |
| Exchange | payout | wrong network for the address, a retry that sends twice, a quote used after it expired |

### 3. Invariants

Rules that must hold **after every change**. Short, checkable, ideally each with a test. These are the rules a
newcomer would not guess from the code.

- **Tokenization:** sold shares of a unit never exceed its total supply · an investment is `confirmed` only with
  a matching successful payment · every query of a Default user is filtered by their own id.
- **Trading bot:** the bot never holds more than the position limit per market · prices are in `[0, 1]` and sizes
  rounded to the market's tick · a missing weather value is `None`, never a default like `0`.
- **Exchange:** amounts are `Decimal`/`bigint` in the coin's smallest unit, never `number` · every movement of
  funds is a ledger entry, balances are derived from the ledger · a payout has an idempotency key and is sent at
  most once · a quote has an expiry and is never used after it.

### 4. Ask the user before

The decisions the agent never takes alone. Without this list it will decide "reasonably" on its own.

Generic: a public API change (route, request or response shape) · a migration · a new dependency · anything on a
critical path. Then add the project's own:

- **Tokenization:** a new role or permission · a change to how payouts are calculated · KYC flows.
- **Trading bot:** strategy parameters (thresholds, sizes, limits) · anything that runs against the live account.
- **Exchange:** fees and spreads · supported coins or networks · confirmation counts · anything touching wallet keys.

### 5. `.claude/harness.json`

What the hooks protect. Each field:

| Field | What to put there | Example |
|---|---|---|
| `secretFiles` | Files the agent never reads or writes (gitignore syntax, `!` re-includes) | `.env*`, `!.env.example`, `*.pem`, `wallet-keys/**`, `gdrive-*.json` |
| `immutableDirs` | Existing files may not be edited or deleted, new ones may be added | `prisma/migrations/`, `migrations/versions/` |
| `protectedDirs` | Never written or deleted at all | `data/`, `models/`, `uploads/` |
| `codePaths` | Project code: no shell writes into it, `sed -i` on one file blocked | add `apps/`, `libs/`, `prisma/` if you have them |
| `blockedCommands` | Regex → reason; always blocked | `prisma migrate reset`, `git push --force`, the CLI that sends funds on mainnet |
| `askCommands` | Regex → reason; the user approves each one | `psql ... DROP`, `curl` to the production API |
| `lint` | Extensions the post-edit lint runs on; rules not reported mid-change | `.vue` for a Vue project |
| `gate` | The check command, attempts, which files count as source, what counts as a suppression | `sourceGlobs: ["apps/**", "libs/**"]` |

After changing it, run `node --test .claude/hooks/test/`: the hook tests read the real file, so fix the tests that
assumed the old paths.

### 6. `make check`: what "done" means

The stop gate runs `make check` before the agent may finish, so it must be:
- **report-only**: no `--fix`, no writes;
- **fast enough** to run at every finish (aim for under a minute);
- **runnable without external services**. Tests that need Postgres, Docker or a testnet stay out of it; say in
  CLAUDE.md › Environments and commands how to run them, and the `/task` skill makes the agent run them for
  the modules it touched.

Add what defines "done" in the project: `prisma validate`, `check-configs`, an OpenAPI diff, a migration lint.

### 7. Glossary

The domain's words **as the code spells them**. The agent names new code with them, and it stops inventing
synonyms (`Asset` next to `Unit`, `Trade` next to `Order`).

- **Tokenization:** **Unit**: a tokenized property offered for investment (not a measurement unit) · **Investment**:
  a user's purchase of shares of a unit · **Payout**: income paid to investors of a unit.
- **Trading bot:** **Bin**: one temperature range of a market, one YES/NO token · **Trading day**: the market's
  day in the city's time zone · **Floor YES**: buying YES on the bin that the observed maximum already reached.
- **Exchange:** **Quote**: a rate offered for a pair, valid until its expiry · **Order**: a user's exchange from
  quote to payout · **Confirmation**: a block on top of the deposit's block.

### 8. Architecture and data flow

Where things live and which way dependencies point, plus the main path through the system in one line. It saves
the agent a dozen file reads at the start of every task.

- **Tokenization:** `HTTP → guards (auth, role, permission) → controller → service → Prisma`, events emitted after
  the transaction commits, BullMQ jobs for e-mail and payouts.
- **Trading bot:** `weather API → forecast → signal (forecast vs price) → strategy → execution engine → CLOB API`;
  `core/` has no I/O and talks to the outside through `core/ports/`.
- **Exchange:** `quote → order → deposit watcher (confirmations) → ledger → payout queue → signer → broadcast`.

### 9. External services

One line per API: what it is for, sandbox vs production, quirks, limits. Quirks are the most valuable part:
they are what the agent cannot know.

- **Trading bot:** Weather Underground: observations arrive with a delay of up to an hour; codes 12 and 13 are
  undocumented. Polymarket CLOB: the client is synchronous, call it through `asyncio.to_thread`.
- **Exchange:** a node provider: rate-limited, can return a block that is later reorged · the KYT/AML provider:
  sandbox answers everything as clean.
- **Tokenization:** the payment provider: webhooks can arrive twice and out of order · S3 with Object Lock:
  locked files cannot be deleted.

### 10. Environments and commands

How to run it locally, what needs a DB or Docker, what `make check` does not cover and how to run that, where it
is deployed, who runs migrations. Also the commands that behave differently without a terminal (for example
`pnpm exec` that tries to reinstall `node_modules`).

### 11. Conventions

The rules of the framework and the team that the linter does not enforce. Examples: "logging only through
`@libs/logger`", "responses built with the DTO's static `create()`", "no default values for DB inserts",
"dataclasses `frozen=True, slots=True`". One line each, with the reason when it is not obvious.

### 12. Team workflow

- **Tracker:** the issue id becomes the plan slug and the branch (`TE-216` → `plans/tasks/te-216.md`, branch
  `te-216`). Put it in the `/task` skill.
- **Extra done-steps:** what the team expects at the end of a task: update `docs/methods/`, post an
  "Affected Routes" report to the issue, add a changelog line. Put them in the skill's Finish section.
- **Branches and commits:** the naming and the base branch (`stage`, `develop`, `main`).

### 13. Reviewer

`.claude/agents/reviewer.md` checks the diff against CLAUDE.md and the plan. Add a line to "What to check" each
time a review missed something the domain made obvious, for example "a payout path without an idempotency key".

---

## Keep it alive

The harness gets better from mistakes, not from writing more rules up front:

- **The agent did something wrong** → one rule in CLAUDE.md with the reason ("X, because Y happened"), or, if it
  must never happen, a guard in `harness.json`. Prefer a check over a sentence: a rule can be ignored, a hook cannot.
- **The agent routed around a guard** (a copy, another tool) → close that route in the hook and add a test for it.
- **A bug reached production** → a failing test first, then the fix, then an invariant if the bug broke one.
- **CLAUDE.md grows past ~300 lines** → it is loaded into every session. Keep the rules and the workflow there; move
  reference material (formats, long how-tos) to `docs/` with a one-line pointer.
- **A problem outside the current task** → `plans/BACKLOG.md` with a trigger, never a silent fix in an unrelated diff.

## Add the harness to an existing project

Copy `.claude/`, `plans/`, and from `CLAUDE.md` the sections from "About" to "Ask the user before", plus
"How to Work", "Definition of Done" and "Guardrails". Then:
- give the project a report-only `make check` and point `gate.checkCommand` at it;
- adjust `.claude/harness.json` (`codePaths`, `immutableDirs`, `gate.sourceGlobs`, `lint.extensions`);
- add `.claude/settings.local.json` and `.claude/.gate/` to `.gitignore`, and make sure `.claude/` itself is not ignored;
- run `node --test .claude/hooks/test/`.

In a monorepo, put `.claude/` in the package and start Claude there: the hooks use `$CLAUDE_PROJECT_DIR`, and git
paths are taken relative to it. Started from the repository root, Claude does not load the package's hooks.

## What is in the harness

| Piece | What it does |
|---|---|
| `CLAUDE.md` | Project knowledge (sections above), how to work (goal → plan → loop → replan → finish), Definition of Done, guardrails, conventions |
| `/task` skill | Criteria → approval → plan file in `plans/tasks/` → step + narrowest check + tick → revisions → review → archive |
| `reviewer` agent | Read-only review of the diff against CLAUDE.md and the plan's acceptance criteria |
| `/grilling`, `/grill-me` | Stress-test a plan or a design with rounds of questions |
| `guard.mjs` (PreToolUse) | Blocks secrets, edits of applied migrations, data deletion, shell writes into code, `sed -i` on one file, dangerous commands; asks before direct DB writes |
| `post_edit.mjs` (PostToolUse) | Oxlint (type-aware) + Prettier check on each edited file in ~0.2 s, reported to the agent at once, without repeating old problems |
| `stop_gate.mjs` (Stop) | No finish while `make check` is red (3 attempts, then report to the user); flags added suppressions and removed tests; rejects a `done` plan with unticked items |
| `harness.json` | Everything project-specific the hooks need; the hooks themselves stay unchanged |
| `plans/` | `tasks/` active plans, `tasks/done/` decision record, `BACKLOG.md` out-of-scope finds with triggers |

## Commands

```bash
make check       # typecheck + lint + test + test-hooks: the definition of done
make lint-fix    # Oxlint --fix, ESLint --fix (Prettier included)
make build       # src/ → dist/
```
