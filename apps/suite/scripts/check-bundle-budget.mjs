// CI gate 9 (Development Plan §5.3): client bundle-size budget. Run after `next build`.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const appDir = new URL('..', import.meta.url).pathname;
const budget = JSON.parse(readFileSync(join(appDir, 'performance-budget.json'), 'utf8'));
const chunksDir = join(appDir, '.next/static/chunks');
if (!existsSync(chunksDir)) {
  console.error('check-bundle-budget: .next/static/chunks not found — run `next build` first');
  process.exit(1);
}

function gzipTotal(dir, ext) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(ext)) {
      total += gzipSync(readFileSync(join(entry.parentPath, entry.name))).length;
    }
  }
  return total / 1024;
}

const js = gzipTotal(chunksDir, '.js');
const css = gzipTotal(join(appDir, '.next/static'), '.css');
const rows = [
  ['client JS (gzip)', js, budget.clientJsGzipKiB],
  ['CSS (gzip)', css, budget.cssGzipKiB],
];
let failed = false;
for (const [label, actual, limit] of rows) {
  const ok = actual <= limit;
  failed ||= !ok;
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual.toFixed(1)} KiB (budget ${limit} KiB)`);
}
process.exit(failed ? 1 : 0);
