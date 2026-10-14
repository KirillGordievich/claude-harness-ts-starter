SHELL := /bin/bash
# Local binaries, not `pnpm exec`: without a TTY (Claude hooks, CI) pnpm may try to reinstall node_modules and abort
BIN := ./node_modules/.bin

.PHONY: help install check typecheck lint lint-fix test test-hooks build

help: ## Show the targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	pnpm install

# The definition of done: the Claude stop gate runs it before the agent may finish. Report only, never rewrites files.
check: typecheck lint test test-hooks ## Type check, lint, tests, hook tests

typecheck: ## TypeScript, no emit
	@$(BIN)/tsc --noEmit -p tsconfig.json

lint: ## Oxlint (type-aware) + ESLint for the rules Oxlint lacks + Prettier, without fixes
	@$(BIN)/oxlint --type-aware --deny-warnings
	@$(BIN)/eslint . --cache --cache-location node_modules/.cache/eslint

lint-fix: ## Oxlint and ESLint with --fix, Prettier --write
	@$(BIN)/oxlint --type-aware --fix --quiet
	@$(BIN)/eslint . --fix

test: ## Vitest, all tests once
	@$(BIN)/vitest run --reporter=dot

test-hooks: ## Tests of the Claude Code hooks (node:test, no dependencies)
	@node --test --test-reporter=dot .claude/hooks/test/

build: ## Compile src/ to dist/
	@$(BIN)/tsc -p tsconfig.build.json
