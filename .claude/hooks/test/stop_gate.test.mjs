import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { loadConfig } from '../lib.mjs';
import { evaluate } from '../stop_gate.mjs';

// The real harness.json, except that `make check` is replaced by "red while a file named FAIL exists".
const harness = loadConfig(path.resolve(import.meta.dirname, '..', '..', '..'));
const config = { ...harness, gate: { ...harness.gate, checkCommand: ['sh', '-c', 'test ! -f FAIL || (echo boom; exit 1)'] } };
let dir;

const write = (rel, content) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
};
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
const stop = () => evaluate(dir, config, 'session');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gate-test-'));
  git('init', '-q');
  write('src/a.ts', 'export const a = 1;\n');
  write('tests/a.test.ts', "test('one', () => {});\ntest('two', () => {});\n");
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('stop gate', () => {
  test('no code changes: the agent may stop', () => {
    assert.equal(stop(), null);
  });

  test('red check blocks, then demands a report, then lets the agent stop', () => {
    write('src/a.ts', 'export const a = 2;\n');
    write('FAIL', '');
    for (let attempt = 1; attempt <= config.gate.maxFixAttempts; attempt++) {
      assert.match(stop().reason, new RegExp(`attempt ${attempt}/`));
    }
    assert.match(stop().reason, /Stop changing code/);
    assert.match(stop().systemMessage, /not done/);
  });

  test('green check with an added suppression blocks once', () => {
    write('src/a.ts', '// eslint-disable-next-line\nexport const a = 2 as any;\n');
    assert.match(stop().reason, /weakens checks/);
    assert.equal(stop(), null);
  });

  test('an oxlint suppression counts as well', () => {
    write('src/a.ts', '// oxlint-disable-next-line no-debugger\nexport const a = 2;\n');
    assert.match(stop().reason, /added: \/\/ oxlint-disable-next-line/);
  });

  test('a removed test case blocks, also when its whole file is deleted', () => {
    write('tests/a.test.ts', "test('one', () => {});\n");
    assert.match(stop().reason, /1 test case\(s\) removed/);
    unlinkSync(path.join(dir, 'tests', 'a.test.ts'));
    assert.match(stop().reason, /2 test case\(s\) removed/);
  });

  test('a done plan with unticked items blocks, even without code changes', () => {
    write('plans/tasks/x.md', 'Status: done\n\n- [x] first\n- [ ] second\n');
    assert.match(stop().reason, /plans\/tasks\/x\.md: \[ \] second/);
    assert.equal(stop(), null);
  });

  test('the plan template is not a plan', () => {
    write('plans/tasks/_TEMPLATE.md', 'Status: done\n- [ ] item\n');
    assert.equal(stop(), null);
  });
});
