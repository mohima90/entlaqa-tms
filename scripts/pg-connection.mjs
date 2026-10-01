#!/usr/bin/env node
// Used by scripts/db-deploy.sh: reads DATABASE_URL, writes a pgpass file (mode 0600) to argv[2] and the
// non-secret connection parts to argv[3] as `KEY=value` lines (PGHOST, PGPORT, PGUSER, PGDATABASE,
// DB_IS_LOCAL). In GitHub Actions it masks every form of the password first. Never prints the URL.
import { writeFileSync } from 'node:fs';
import { parseDatabaseUrl, pgpassLine } from './lib/pg-url.mjs';

const [passFile, envFile] = process.argv.slice(2);
if (!passFile || !envFile) {
  console.error('usage: pg-connection.mjs <pgpass-file> <env-file>');
  process.exit(2);
}

let connection;
try {
  connection = parseDatabaseUrl(process.env.DATABASE_URL ?? '');
} catch (error) {
  console.error(`db-deploy: ${error.message}`);
  process.exit(1);
}

if (process.env.GITHUB_ACTIONS === 'true') {
  for (const form of connection.passwordForms) process.stdout.write(`::add-mask::${form}\n`);
}
writeFileSync(passFile, `${pgpassLine(connection)}\n`, { mode: 0o600 });
writeFileSync(
  envFile,
  [
    `PGHOST=${connection.host}`,
    `PGPORT=${connection.port}`,
    `PGUSER=${connection.user}`,
    `PGDATABASE=${connection.database}`,
    `DB_IS_LOCAL=${connection.isLocal ? 1 : 0}`,
    '',
  ].join('\n'),
);
