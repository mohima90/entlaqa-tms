#!/usr/bin/env node
// CI gate 1 (Development Plan §5.3): licence check of all installed dependencies (prod + dev).
import { execFileSync } from 'node:child_process';
import { checkLicenses } from './lib/licenses.mjs';

const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(raw);
const errors = checkLicenses(byLicense);
const total = Object.values(byLicense).reduce((n, list) => n + list.length, 0);
if (errors.length > 0) {
  console.error(`Licence check failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.error(`Licence check passed (${total} packages).`);
