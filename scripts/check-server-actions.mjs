#!/usr/bin/env node
// CI gate (ADR 0003 §4.6): server actions / mutating routes must use defineAction / defineRoute.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SCANNED_SOURCE, checkServerActionsSource } from './lib/server-actions.mjs';

const root = new URL('..', import.meta.url).pathname;
const SKIP = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'e2e',
  '__fixtures__',
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (
      SCANNED_SOURCE.test(entry) &&
      !/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry) &&
      !/\.d\.(ts|mts|cts)$/.test(entry)
    )
      yield full;
  }
}

const roots = [
  'modules',
  'apps',
  ...readdirSync(join(root, 'packages'))
    .filter((p) => p.startsWith('platform-'))
    .map((p) => `packages/${p}`),
];
const errors = [];
let files = 0;
for (const r of roots) {
  for (const file of walk(join(root, r))) {
    files += 1;
    errors.push(...checkServerActionsSource(relative(root, file), readFileSync(file, 'utf8')));
  }
}
if (errors.length > 0) {
  console.error(`Server action check failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.error(`Server action check passed (${files} files scanned).`);
