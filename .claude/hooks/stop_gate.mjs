#!/usr/bin/env node
// Stop hook: the agent cannot finish while `make check` is red.
//
// - No code changes in the working tree: nothing to verify, the agent may stop.
// - `make check` red: block, the output goes back to the agent. After `gate.maxFixAttempts`
//   blocks it is told to stop fixing and report to the user; the next stop is let through.
// - `make check` green but the diff adds suppressions (harness.json `gate.suppression`) or removes
//   tests: block once so the agent removes them or justifies each one to the user.
// - A changed plan in plans/tasks/ says `Status: done` but still has unticked items: block once
//   per set of items, so the agent ticks what is verified or reopens the plan.
//
// Git paths are taken relative to the project directory (`--relative`), so the hooks also work
// in a package of a monorepo whose git root is higher up.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMain, loadConfig, matchesGlobs, projectDir, readEvent } from './lib.mjs';

const OUTPUT_HEAD_LINES = 60;
const OUTPUT_TAIL_LINES = 140;
const TASK_PLANS = 'plans/tasks';
const PLAN_TEMPLATE = '_TEMPLATE.md';
const PLAN_DONE = /^Status:\s*done\s*$/m;
const UNTICKED_ITEM = /^\s*- \[ \] (.+)$/gm;

function git(dir, ...args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf-8' }).stdout ?? '';
}

function lines(text) {
  return text.split('\n').filter((line) => line.trim());
}

function untracked(dir, ...pathspecs) {
  return lines(git(dir, 'ls-files', '--others', '--exclude-standard', '--', ...pathspecs));
}

export function hasCodeChanges(dir, config) {
  const codePaths = config.codePaths.filter((entry) => !entry.startsWith('plans/'));

  return git(dir, 'status', '--porcelain', '--', ...codePaths).trim() !== '';
}

function runChecks(dir, config) {
  const [command, ...args] = config.gate.checkCommand;
  const result = spawnSync(command, args, { cwd: dir, encoding: 'utf-8', env: { ...process.env, CI: 'true' } });
  let output = lines(`${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`);
  if (output.length > OUTPUT_HEAD_LINES + OUTPUT_TAIL_LINES) {
    const skipped = output.length - OUTPUT_HEAD_LINES - OUTPUT_TAIL_LINES;
    output = [...output.slice(0, OUTPUT_HEAD_LINES), `... ${skipped} lines skipped ...`, ...output.slice(-OUTPUT_TAIL_LINES)];
  }

  return [result.status === 0, output.join('\n')];
}

// Suppressions added and test cases removed by the uncommitted diff of source files.
export function findWeakenedChecks(dir, config) {
  const suppression = new RegExp(config.gate.suppression);
  const testCase = new RegExp(config.gate.testCase);
  const added = [];
  let removedTests = 0;
  let inSource = false;
  for (const line of git(dir, 'diff', 'HEAD', '-U0', '--relative').split('\n')) {
    // file header: `--- a/old` then `+++ b/new`; a new file has `--- /dev/null`, a deleted one `+++ /dev/null`
    if (line.startsWith('--- ')) {
      inSource = line !== '--- /dev/null' && matchesGlobs(line.slice('--- a/'.length), config.gate.sourceGlobs);
    } else if (line.startsWith('+++ ')) {
      if (line !== '+++ /dev/null') inSource = matchesGlobs(line.slice('+++ b/'.length), config.gate.sourceGlobs);
    } else if (inSource && line.startsWith('+')) {
      added.push(line.slice(1));
    } else if (inSource && line.startsWith('-') && testCase.test(line.slice(1))) {
      removedTests += 1;
    }
  }
  for (const file of untracked(dir).filter((rel) => matchesGlobs(rel, config.gate.sourceGlobs))) {
    added.push(...readFileSync(path.join(dir, file), 'utf-8').split('\n'));
  }

  removedTests -= added.filter((line) => testCase.test(line)).length;
  const findings = added.filter((line) => suppression.test(line)).map((line) => `added: ${line.trim()}`);
  if (removedTests > 0) findings.push(`${removedTests} test case(s) removed`);

  return findings;
}

// Unticked items of changed task plans that claim `Status: done`.
export function findUnfinishedDonePlans(dir) {
  const changed = new Set([
    ...lines(git(dir, 'diff', 'HEAD', '--name-only', '--relative', '--', TASK_PLANS)),
    ...untracked(dir, TASK_PLANS),
  ]);
  const findings = [];
  for (const rel of changed) {
    const file = path.join(dir, rel);
    if (path.basename(rel) === PLAN_TEMPLATE || path.extname(rel) !== '.md' || !existsSync(file)) continue;
    const text = readFileSync(file, 'utf-8');
    if (!PLAN_DONE.test(text)) continue;
    for (const match of text.matchAll(UNTICKED_ITEM)) findings.push(`${rel}: [ ] ${match[1].trim().slice(0, 100)}`);
  }

  return findings;
}

function fingerprint(items) {
  return createHash('sha256').update(items.join('\n')).digest('hex');
}

function stateFile(dir, sessionId) {
  return path.join(dir, '.claude', '.gate', `${sessionId}.json`);
}

function loadState(dir, sessionId) {
  const file = stateFile(dir, sessionId);

  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
}

function saveState(dir, sessionId, state) {
  const file = stateFile(dir, sessionId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

// Returns the hook's stdout payload, or null to let the agent stop.
export function evaluate(dir, config, sessionId) {
  const state = loadState(dir, sessionId);
  const block = (reason) => ({ decision: 'block', reason });

  // a plan may be closed in a session that changed no code, so this runs before the code check
  const unfinished = findUnfinishedDonePlans(dir);
  if (unfinished.length > 0 && state.planReported !== fingerprint(unfinished)) {
    saveState(dir, sessionId, { ...state, planReported: fingerprint(unfinished) });

    return block(
      'Stop gate: a plan says `Status: done` but has unticked items:\n' +
        unfinished.map((item) => `- ${item}`).join('\n') +
        '\n\nFor each one: if its check is green, tick it with Edit; if not, it is not done. Then set ' +
        'Status to `in progress` or `blocked` and tell the user what is left. Never tick items in bulk.',
    );
  }

  if (!hasCodeChanges(dir, config)) return null;
  const [passed, output] = runChecks(dir, config);
  const maxAttempts = config.gate.maxFixAttempts;

  if (!passed) {
    const failures = (state.failures ?? 0) + 1;
    saveState(dir, sessionId, { ...state, failures });
    if (failures <= maxAttempts) {
      return block(
        `Stop gate: \`make check\` is red (attempt ${failures}/${maxAttempts}). The task is not done. ` +
          'Fix the cause; never weaken, skip or delete a check to get green. ' +
          `If a failure disproves an assumption of the plan, add a Revision to the plan file first.\n\n${output}`,
      );
    }
    if (failures === maxAttempts + 1) {
      return block(
        `Stop gate: \`make check\` is still red after ${maxAttempts} attempts. Stop changing code. ` +
          'Tell the user plainly that the task is NOT done: which checks fail, what you tried, ' +
          'what you think the cause is, and what decision you need from them. Then stop.',
      );
    }

    return { systemMessage: '⛔ Stop gate: make check is red, the task is not done.' };
  }

  const findings = findWeakenedChecks(dir, config);
  if (findings.length > 0 && state.disclosed !== fingerprint(findings)) {
    saveState(dir, sessionId, { disclosed: fingerprint(findings), planReported: state.planReported });

    return block(
      'Stop gate: `make check` is green, but the diff weakens checks:\n' +
        findings.map((finding) => `- ${finding}`).join('\n') +
        '\n\nRemove each one, or keep it only if it is truly justified and, in your final message, ' +
        'list it with the reason so the user can decide.',
    );
  }

  // green: the fix-attempt counter starts over; what was already reported stays reported
  saveState(dir, sessionId, { disclosed: findings.length > 0 ? state.disclosed : null, planReported: state.planReported });

  return null;
}

function main() {
  const event = readEvent();
  const dir = projectDir();
  const payload = evaluate(dir, loadConfig(dir), event.session_id ?? 'unknown');
  if (payload) process.stdout.write(JSON.stringify(payload));
}

if (isMain(import.meta.url)) main();
