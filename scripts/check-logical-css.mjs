#!/usr/bin/env node
// Lint gate: no physical-direction styles in UI code (RTL-first). Test files are excluded.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkLogicalSource } from './lib/logical-css.mjs';

const root = new URL('..', import.meta.url).pathname;
const SKIP = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'e2e',
  'public',
  'storybook-static',
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx|css)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) yield full;
  }
}

const errors = [];
for (const r of ['apps', 'packages/ui', 'modules']) {
  for (const file of walk(join(root, r)))
    errors.push(...checkLogicalSource(relative(root, file), readFileSync(file, 'utf8')));
}
if (errors.length > 0) {
  console.error(`RTL logical-properties check failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.error('RTL logical-properties check passed.');
