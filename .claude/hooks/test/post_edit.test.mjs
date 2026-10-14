import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { countKeys, formatReport, problemLines, splitByNovelty } from '../post_edit.mjs';

// shape of `oxlint -f json` output (trimmed)
const oxlintJson = JSON.stringify({
  diagnostics: [
    {
      message: 'Promises must be awaited, add void operator to ignore.',
      code: 'typescript(no-floating-promises)',
      severity: 'error',
      help: 'Mark the promise as ignored with `void`.',
      filename: 'src/a.ts',
      labels: [{ span: { offset: 90, length: 6, line: 6, column: 3 } }],
    },
    { message: 'Unexpected any.', code: 'typescript(no-explicit-any)', severity: 'error', filename: 'src/a.ts', labels: [] },
  ],
  number_of_files: 1,
});

describe('post_edit', () => {
  test('Oxlint JSON becomes one line per problem, with the help text when there is one', () => {
    assert.deepEqual(problemLines(oxlintJson, 'src/a.ts'), [
      'src/a.ts:6:3: Promises must be awaited, add void operator to ignore. [typescript(no-floating-promises)] help: Mark the promise as ignored with `void`.',
      'src/a.ts:0:0: Unexpected any. [typescript(no-explicit-any)]',
    ]);
  });

  test('a problem reported before is counted, not listed, even after its line moved', () => {
    const first = ['src/a.ts:3:8: Unexpected any. [typescript(no-explicit-any)]'];
    const second = [
      'src/a.ts:9:8: Unexpected any. [typescript(no-explicit-any)]',
      'src/a.ts:12:1: `debugger` statement is not allowed [eslint(no-debugger)]',
    ];
    const [newProblems, repeated] = splitByNovelty(second, countKeys(first));
    assert.deepEqual(newProblems, ['src/a.ts:12:1: `debugger` statement is not allowed [eslint(no-debugger)]']);
    assert.equal(repeated, 1);
  });

  test('an unformatted file gets the Prettier hint, a lint problem alone does not', () => {
    const unformatted = ['src/a.ts: not formatted by Prettier [prettier]'];
    assert.match(formatReport('src/a.ts', unformatted, unformatted, 0), /prettier --write src\/a\.ts/);
    const lintOnly = ['src/a.ts:2:1: Unexpected any. [typescript(no-explicit-any)]'];
    assert.doesNotMatch(formatReport('src/a.ts', lintOnly, lintOnly, 0), /prettier/);
  });
});
