// Shared helpers of the Claude Code hooks. Project specifics live in .claude/harness.json, not here.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}

export function loadConfig(dir = projectDir()) {
  return JSON.parse(readFileSync(path.join(dir, '.claude', 'harness.json'), 'utf-8'));
}

export function readEvent() {
  return JSON.parse(readFileSync(0, 'utf-8'));
}

// True when the module is run as a script (`node hook.mjs`), false when a test imports it.
export function isMain(importMetaUrl) {
  return process.argv[1] !== undefined && importMetaUrl === pathToFileURL(path.resolve(process.argv[1])).href;
}

// Path relative to the project, with forward slashes, or null if the file is outside it.
export function relativePath(filePath, dir = projectDir()) {
  if (!filePath) return null;
  const rel = path.relative(dir, path.resolve(dir, filePath));

  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/');
}

function escapeRegExp(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

// Glob → RegExp over a project-relative path. `**` crosses directories, `*` and `?` do not.
// A pattern without a slash matches the base name at any depth (`*.pem`, `.env`), like .gitignore.
export function globToRegExp(glob) {
  const anyDepth = !glob.includes('/');
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      source += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`^${anyDepth ? '(?:.*/)?' : ''}${source}$`);
}

// Matches .gitignore-style lists: later `!pattern` entries re-include what earlier ones matched.
export function matchesGlobs(rel, globs) {
  let matched = false;
  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (matched && globToRegExp(glob.slice(1)).test(rel)) matched = false;
    } else if (globToRegExp(glob).test(rel)) {
      matched = true;
    }
  }

  return matched;
}

// `dir/` entries match everything under the directory, other entries are exact files.
export function isUnder(rel, prefixes) {
  return prefixes.some((prefix) => (prefix.endsWith('/') ? rel.startsWith(prefix) : rel === prefix));
}
