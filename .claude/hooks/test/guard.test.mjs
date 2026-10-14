import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { decide, inPlaceTargets, splitSimpleCommands } from '../guard.mjs';
import { globToRegExp, loadConfig, matchesGlobs } from '../lib.mjs';

const config = loadConfig(path.resolve(import.meta.dirname, '..', '..', '..'));
let dir;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'guard-test-'));
  mkdirSync(path.join(dir, 'migrations'));
  writeFileSync(path.join(dir, 'migrations', '0001_init.sql'), '');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const action = (tool, input) => decide(tool, input, config, dir).action;
const bash = (command) => action('Bash', { command });
const file = (rel) => path.join(dir, rel);

describe('globs', () => {
  test('a pattern without a slash matches at any depth', () => {
    assert.ok(globToRegExp('*.pem').test('certs/server.pem'));
    assert.ok(globToRegExp('.env').test('apps/api/.env'));
  });
  test('`*` stays inside a directory, `**` crosses directories', () => {
    assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
    assert.ok(globToRegExp('src/**').test('src/a/b.ts'));
  });
  test('a later `!pattern` re-includes', () => {
    assert.ok(matchesGlobs('.env.local', config.secretFiles));
    assert.ok(!matchesGlobs('.env.example', config.secretFiles));
  });
});

describe('file tools', () => {
  test('secrets are never read or written', () => {
    assert.equal(action('Read', { file_path: file('.env') }), 'block');
    assert.equal(action('Read', { file_path: file('.env.production') }), 'block');
    assert.equal(action('Write', { file_path: file('secrets/key.json') }), 'block');
    assert.equal(action('Read', { file_path: file('.env.example') }), 'allow');
    assert.equal(action('Read', { file_path: file('src/index.ts') }), 'allow');
  });
  test('an existing migration is immutable, a new one may be written', () => {
    assert.equal(action('Edit', { file_path: file('migrations/0001_init.sql') }), 'block');
    assert.equal(action('Write', { file_path: file('migrations/0001_init.sql') }), 'block');
    assert.equal(action('Write', { file_path: file('migrations/0002_users.sql') }), 'allow');
  });
  test('protected data is never written', () => {
    assert.equal(action('Write', { file_path: file('data/app.db') }), 'block');
  });
  test('files outside the project are not guarded', () => {
    assert.equal(action('Write', { file_path: '/tmp/elsewhere/.env' }), 'allow');
  });
});

describe('shell commands', () => {
  test('commands naming a secret file are blocked', () => {
    assert.equal(bash('cat .env'), 'block');
    assert.equal(bash('grep TOKEN ./.env.local'), 'block');
    assert.equal(bash('node --env-file=.env src/index.ts'), 'block');
    assert.equal(bash('cat .env.example'), 'allow');
  });
  test('blocked commands from harness.json', () => {
    assert.equal(bash('git push --force origin main'), 'block');
    assert.equal(bash('git reset --hard HEAD~1'), 'block');
    assert.equal(bash('pnpm exec prisma migrate reset'), 'block');
    assert.equal(bash('git push origin feat/x'), 'allow');
  });
  test('shell writes into project code are blocked, elsewhere allowed', () => {
    assert.equal(bash('echo x > src/a.ts'), 'block');
    assert.equal(bash('cat <<EOF >> CLAUDE.md\nhi\nEOF'), 'block');
    assert.equal(bash('echo x | tee plans/tasks/a.md'), 'block');
    assert.equal(bash('echo x > /tmp/out.txt'), 'allow');
    assert.equal(bash('make check 2>&1 | tail -5'), 'allow');
  });
  test('sed -i: one code file blocked, a glob allowed, plans and migrations never', () => {
    assert.equal(bash('sed -i s/a/b/ src/a.ts'), 'block');
    assert.equal(bash('sed -i s/a/b/ src/*.ts'), 'allow');
    assert.equal(bash('sed -i s/x/y/ plans/tasks/*.md'), 'block');
    assert.equal(bash("perl -pi -e 's/a/b/' migrations/*.sql"), 'block');
    assert.equal(bash('sed -n 1,5p src/a.ts'), 'allow');
  });
  test('migrations and data are never deleted', () => {
    assert.equal(bash('rm migrations/0001_init.sql'), 'block');
    assert.equal(bash('rm -rf data'), 'block');
    assert.equal(bash('rm -rf dist'), 'allow');
  });
  test('a direct database write asks the user', () => {
    assert.equal(bash('psql "$DATABASE_URL" -c "DROP TABLE users"'), 'ask');
    assert.equal(bash('psql "$DATABASE_URL" -c "SELECT 1"'), 'allow');
  });
});

describe('shell parsing', () => {
  test('splits simple commands, respecting quotes', () => {
    assert.deepEqual(splitSimpleCommands(`a 'b; c' && d | e`), [['a', 'b; c'], ['d'], ['e']]);
    assert.deepEqual(splitSimpleCommands(`echo "unbalanced`), []);
  });
  test('finds sed and perl in-place targets', () => {
    assert.deepEqual(inPlaceTargets(['sed', '-i', 's/a/b/', 'x.ts']), ['x.ts']);
    assert.deepEqual(inPlaceTargets(['sed', '-i.bak', '-e', 's/a/b/', 'x.ts', 'y.ts']), ['x.ts', 'y.ts']);
    assert.deepEqual(inPlaceTargets(['perl', '-pi', '-e', 's/a/b/', 'x.ts']), ['x.ts']);
    assert.equal(inPlaceTargets(['sed', 's/a/b/', 'x.ts']), null);
  });
});
