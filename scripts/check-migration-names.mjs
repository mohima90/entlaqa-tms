#!/usr/bin/env node
// CI gate: migration file naming (ADR 0001), rollback presence (migration-conventions.md §6) and no
// schema exposed through the Supabase Data API (ADR 0002 §5, supabase/config.toml).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkMigrationNames, checkRollbacks, schemasFromModules } from './lib/migration-names.mjs';
import { checkSupabaseApiConfig } from './lib/supabase-config.mjs';

const root = new URL('..', import.meta.url).pathname;
const migrationsDir = join(root, 'supabase/migrations');
const modulesDir = join(root, 'modules');

const modules = readdirSync(modulesDir).filter((d) => statSync(join(modulesDir, d)).isDirectory());
const files = readdirSync(migrationsDir);
const rollbacks = readdirSync(join(root, 'supabase/rollbacks'));
const errors = [
  ...checkMigrationNames(files, schemasFromModules(modules)),
  ...checkRollbacks(files, rollbacks),
  ...checkSupabaseApiConfig(readFileSync(join(root, 'supabase/config.toml'), 'utf8')),
];

if (files.filter((f) => f.endsWith('.sql')).length === 0) errors.push('no migrations found');
if (errors.length > 0) {
  console.error(`Migration naming check failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.error(`Migration naming check passed (${files.length} files).`);
