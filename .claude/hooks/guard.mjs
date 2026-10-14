#!/usr/bin/env node
// PreToolUse guard: blocks actions the agent must never take, asks the user about risky ones.
// What counts as a secret, a migration or a dangerous command comes from .claude/harness.json.
//
// Exit code 2 blocks the tool call; stderr goes back to the agent as the reason.
// A JSON `permissionDecision: "ask"` on stdout lets the user approve the call instead.

import { existsSync } from 'node:fs';
import path from 'node:path';

import { isMain, isUnder, loadConfig, matchesGlobs, projectDir, readEvent, relativePath } from './lib.mjs';

const FILE_WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const IN_PLACE_EDITORS = new Set(['sed', 'perl']);
const SEPARATORS = new Set([';', '|', '&', '(', ')', '\n']);

const allow = { action: 'allow' };
const block = (reason) => ({ action: 'block', reason });

// Words of each simple command (split on ; && || | & and parentheses), quotes respected; [] if unparsable.
export function splitSimpleCommands(command) {
  const commands = [[]];
  let word = '';
  let hasWord = false;
  let quote = null;
  const endWord = () => {
    if (hasWord) commands[commands.length - 1].push(word);
    word = '';
    hasWord = false;
  };
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      hasWord = true;
    } else if (SEPARATORS.has(char)) {
      endWord();
      if (commands[commands.length - 1].length > 0) commands.push([]);
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word += char;
      hasWord = true;
    }
  }
  if (quote) return []; // unbalanced quotes, e.g. inside a heredoc body
  endWord();

  return commands.filter((words) => words.length > 0);
}

// Files a `sed -i` / `perl -i` command edits in place, or null if it is not an in-place edit.
export function inPlaceTargets(words) {
  if (!IN_PLACE_EDITORS.has(path.basename(words[0]))) return null;
  let inPlace = false;
  let scriptGiven = false;
  let expectsScript = false;
  const operands = [];
  for (const word of words.slice(1)) {
    if (expectsScript) {
      expectsScript = false;
    } else if (word === '--in-place' || word.startsWith('--in-place=')) {
      inPlace = true;
    } else if (['-e', '-f', '--expression', '--file'].includes(word)) {
      scriptGiven = expectsScript = true;
    } else if (word.startsWith('-') && !word.startsWith('--') && word.length > 1) {
      const flags = word.slice(1).split('.')[0]; // -i.bak: backup suffix after the dot
      inPlace ||= flags.includes('i');
      if (flags.endsWith('e')) scriptGiven = expectsScript = true; // perl -pe: the script is the next word
    } else if (!word.startsWith('-')) {
      operands.push(word);
    }
  }
  if (!inPlace) return null;

  return scriptGiven ? operands : operands.slice(1);
}

function checkFileWrite(toolName, filePath, config, dir) {
  const rel = relativePath(filePath, dir);
  if (rel === null) return allow;
  if (matchesGlobs(rel, config.secretFiles))
    return block(`${rel} holds secrets: the agent never reads or writes it. Ask the user to change it.`);
  if (isUnder(rel, config.protectedDirs)) return block(`${rel}: ${config.protectedReason}. Ask the user before touching it.`);
  if (isUnder(rel, config.immutableDirs) && (toolName !== 'Write' || existsSync(path.join(dir, rel)))) {
    return block(`${rel} must not be edited: ${config.immutableReason}.`);
  }

  return allow;
}

function checkFileRead(filePath, config, dir) {
  const rel = relativePath(filePath, dir);
  if (rel !== null && matchesGlobs(rel, config.secretFiles)) {
    return block(`${rel} holds secrets: the agent never reads it. Use .env.example to learn the variable names.`);
  }

  return allow;
}

// Every word that names a secret file: `cat .env`, `--env-file=.env`, `>.env.local`.
function secretInCommand(words, config, dir) {
  for (const word of words) {
    for (const candidate of word.split('=')) {
      const rel = relativePath(candidate.replace(/^[<>]+/, ''), dir);
      if (rel && matchesGlobs(rel, config.secretFiles)) return rel;
    }
  }

  return null;
}

function codePathPattern(config, dir) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = `(?:\\./|${escape(dir)}/)?`;
  const entries = config.codePaths.map((entry) => (entry.endsWith('/') ? escape(entry) : `${escape(entry)}(?![\\w.-])`));

  return `['"]?${prefix}(?:${entries.join('|')})`;
}

function checkCommand(command, config, dir) {
  const simpleCommands = splitSimpleCommands(command);
  const secret = secretInCommand(simpleCommands.flat(), config, dir);
  if (secret) return block(`The command touches ${secret}, which holds secrets. Use .env.example; ask the user if you need a real value.`);

  for (const { pattern, reason } of config.blockedCommands) {
    if (new RegExp(pattern).test(command)) return block(reason);
  }

  for (const words of simpleCommands) {
    const targets = inPlaceTargets(words)?.map((target) => relativePath(target, dir) ?? target);
    if (!targets?.length) continue;
    const guarded = targets.filter((rel) => isUnder(rel, [...config.immutableDirs, ...config.protectedDirs, 'plans/']));
    if (guarded.length > 0) {
      return block(
        `\`${words[0]} -i\` on ${guarded.join(', ')} is forbidden: migrations, data and plan files are never edited in place. ` +
          'A plan item is ticked with Edit, one at a time, after its check is green.',
      );
    }
    if (targets.length === 1 && !/[*?[]/.test(targets[0]) && isUnder(targets[0], config.codePaths)) {
      return block(
        `\`${words[0]} -i\` on a single file (${targets[0]}) is forbidden: change it with Edit, so the path checks, ` +
          'the lint hook and the diff see it. `sed -i` is only for one replacement across many files.',
      );
    }
  }

  // `> path`, `>> path`, `tee path` into project code: skips Edit/Write, so the path checks and post_edit
  const code = codePathPattern(config, dir);
  if (new RegExp(`(?<![-=>&\\d])>{1,2}\\s*${code}|\\btee\\s+(?:-\\S+\\s+)*${code}`).test(command)) {
    return block(
      'Writing project files through the shell (`>`, `>>`, `tee`, heredoc) is forbidden: it bypasses the path checks, ' +
        'the lint hook and the diff. Use Edit for changes and Write for new files. A mechanical replacement across ' +
        'many files may use `sed -i`; run `make check` after it.',
    );
  }

  // `rm migrations/x.sql` and `rm -rf migrations` alike: a trailing slash makes the directory itself match
  const undeletable = [...config.immutableDirs, ...config.protectedDirs];
  const removed = simpleCommands
    .filter((words) => path.basename(words[0]) === 'rm')
    .flatMap((words) => words.slice(1).filter((word) => !word.startsWith('-')))
    .map((word) => relativePath(word, dir))
    .filter((rel) => rel !== null && isUnder(`${rel}/`, undeletable));
  if (removed.length > 0)
    return block(`Deleting ${removed.join(', ')} is forbidden: the agent never deletes migrations or data. Ask the user.`);

  for (const { pattern, reason } of config.askCommands) {
    if (new RegExp(pattern, 'i').test(command)) return { action: 'ask', reason };
  }

  return allow;
}

export function decide(toolName, toolInput, config, dir) {
  if (FILE_WRITE_TOOLS.has(toolName)) return checkFileWrite(toolName, toolInput.file_path ?? toolInput.notebook_path ?? '', config, dir);
  if (toolName === 'Read') return checkFileRead(toolInput.file_path ?? '', config, dir);
  if (toolName === 'Bash') return checkCommand(toolInput.command ?? '', config, dir);

  return allow;
}

function main() {
  const event = readEvent();
  const dir = projectDir();
  const decision = decide(event.tool_name ?? '', event.tool_input ?? {}, loadConfig(dir), dir);
  if (decision.action === 'block') {
    process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${decision.reason}\n`);
    process.exit(2);
  }
  if (decision.action === 'ask') {
    const output = { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: decision.reason };
    process.stdout.write(JSON.stringify({ hookSpecificOutput: output }));
  }
}

if (isMain(import.meta.url)) main();
