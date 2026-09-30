// Copies static assets next to the standalone server (Next.js does not do this itself).
// Container images (ADR 0010) and `pnpm start` / E2E run from .next/standalone.
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const appDir = new URL('..', import.meta.url).pathname;
const standaloneApp = join(appDir, '.next/standalone/apps/suite');

if (!existsSync(standaloneApp)) {
  console.error(
    'prepare-standalone: .next/standalone not found — did `next build` run with output: standalone?',
  );
  process.exit(1);
}
cpSync(join(appDir, '.next/static'), join(standaloneApp, '.next/static'), { recursive: true });
if (existsSync(join(appDir, 'public'))) {
  cpSync(join(appDir, 'public'), join(standaloneApp, 'public'), { recursive: true });
}
console.error('prepare-standalone: static assets copied');
