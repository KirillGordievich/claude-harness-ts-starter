#!/usr/bin/env node
// PostToolUse: lint the edited file with Oxlint (type-aware) and check its Prettier formatting, and report
// problems to the agent right away. Oxlint takes ~0.2 s per file where type-checked ESLint takes seconds, so the
// agent gets feedback after every Edit; `make check` still runs the full ESLint before the agent may finish.
//
// Reports only, never rewrites the file: an autofix behind the agent's back would make its next Edit miss.
// Exit code 2 shows stderr to the agent; the edit itself is already done.
// The rules in harness.json `lint.midChangeRules` (unused variables and imports) are not reported: mid-change they
// are usually an import added one Edit before its use, and the stop gate's `make check` still catches the rest.
// A problem the agent was already told about in this session is not listed again: after several Edits in one
// file the report shows only the new problems and a count of the old ones. Problems are matched by rule and
// message, not by line number, because the line numbers shift with every Edit.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isMain, loadConfig, projectDir, readEvent, relativePath } from './lib.mjs';

const REPORTED_DIR = path.join(tmpdir(), 'claude-post-edit-reported');
const NOT_FORMATTED = 'not formatted by Prettier [prettier]';

// Oxlint JSON output → one line per problem: "path:line:col: message [rule] help: ..."
export function problemLines(oxlintJson, rel) {
  const { diagnostics } = JSON.parse(oxlintJson);

  return diagnostics.map((diagnostic) => {
    const span = diagnostic.labels?.[0]?.span;
    const help = diagnostic.help ? ` help: ${diagnostic.help}` : '';

    return `${rel}:${span?.line ?? 0}:${span?.column ?? 0}: ${diagnostic.message} [${diagnostic.code}]${help}`;
  });
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ status: null, stdout, stderr: error.message }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function problemKey(line) {
  return line.replace(/^\S+?:\d+:\d+: /, '');
}

// Returns [problems not reported before, how many were reported before].
export function splitByNovelty(lines, alreadyReported) {
  const unreported = { ...alreadyReported };
  const newProblems = [];
  let repeated = 0;
  for (const line of lines) {
    const key = problemKey(line);
    if ((unreported[key] ?? 0) > 0) {
      unreported[key] -= 1;
      repeated += 1;
    } else {
      newProblems.push(line);
    }
  }

  return [newProblems, repeated];
}

export function countKeys(lines) {
  const counts = {};
  for (const line of lines) counts[problemKey(line)] = (counts[problemKey(line)] ?? 0) + 1;

  return counts;
}

export function formatReport(rel, lines, newProblems, repeated) {
  const report = [`lint found problems in ${rel} (fix them before finishing):`, ...newProblems];
  if (repeated > 0) report.push(`... and ${repeated} more reported earlier, still unfixed.`);
  if (lines.some((line) => line.endsWith(NOT_FORMATTED))) {
    report.push(`Formatting: run \`./node_modules/.bin/prettier --write ${rel}\`, then Read the file before the next Edit.`);
  }

  return report.join('\n');
}

function reportedFile(sessionId, filePath) {
  const name = createHash('sha256').update(`${sessionId}:${filePath}`).digest('hex').slice(0, 32);

  return path.join(REPORTED_DIR, `${name}.json`);
}

function loadReported(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function saveReported(file, counts) {
  try {
    mkdirSync(REPORTED_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(counts));
  } catch {
    // without the memory the next report is simply the full list
  }
}

async function lintFile(dir, config, rel) {
  const bin = (name) => path.join(dir, 'node_modules', '.bin', name);
  const allowMidChange = config.lint.midChangeRules.flatMap((rule) => ['-A', rule]);
  const [oxlint, prettier] = await Promise.all([
    run(bin('oxlint'), ['--type-aware', '-f', 'json', ...allowMidChange, rel], dir),
    existsSync(bin('prettier')) ? run(bin('prettier'), ['--check', '--log-level', 'silent', rel], dir) : { status: 0 },
  ]);
  let lines;
  try {
    lines = problemLines(oxlint.stdout, rel);
  } catch {
    lines = `${oxlint.stdout}${oxlint.stderr}`.split('\n').filter((line) => line.trim()); // not JSON: show as is
  }
  if (prettier.status !== 0) lines.push(`${rel}: ${NOT_FORMATTED}`);

  return lines;
}

async function main() {
  const event = readEvent();
  const dir = projectDir();
  const config = loadConfig(dir);
  const filePath = path.resolve(dir, event.tool_input?.file_path ?? '');
  const rel = relativePath(filePath, dir);
  if (rel === null || !config.lint.extensions.includes(path.extname(filePath)) || !existsSync(filePath)) return;
  if (!existsSync(path.join(dir, 'node_modules', '.bin', 'oxlint'))) return; // dependencies not installed: nothing to run

  const lines = await lintFile(dir, config, rel);
  const memory = reportedFile(String(event.session_id ?? ''), filePath);
  if (lines.length === 0) {
    rmSync(memory, { force: true });

    return;
  }

  const [newProblems, repeated] = splitByNovelty(lines, loadReported(memory));
  saveReported(memory, countKeys(lines));
  process.stderr.write(`${formatReport(rel, lines, newProblems, repeated)}\n`);
  process.exit(2);
}

if (isMain(import.meta.url)) await main();
