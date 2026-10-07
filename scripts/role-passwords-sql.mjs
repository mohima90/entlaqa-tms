#!/usr/bin/env node
// Prints `ALTER ROLE … PASSWORD '<SCRAM verifier>'` for the database login roles (ADR 0002 §5, §7) from
// APP_SERVER_DB_PASSWORD / APP_WORKER_DB_PASSWORD / APP_QUEUE_DB_PASSWORD, for piping straight into psql (scripts/db-deploy.sh).
// Only verifiers are printed, never the passwords. A role whose variable is unset is left unchanged.
// The salt is derived from role and password, so an unchanged password gives the identical verifier on
// every deploy (no change for the connection pooler's credential cache).
import { checkPassword, scramSha256Verifier, stableSalt } from './lib/scram.mjs';

const ROLES = [
  ['app_server', 'APP_SERVER_DB_PASSWORD'],
  ['app_worker', 'APP_WORKER_DB_PASSWORD'],
  ['app_queue', 'APP_QUEUE_DB_PASSWORD'],
];

const statements = [];
const errors = [];
for (const [role, variable] of ROLES) {
  const password = process.env[variable];
  if (password === undefined || password === '') continue;
  const problems = checkPassword(password);
  if (problems.length > 0) {
    errors.push(`${variable} ${problems.join('; ')}`);
    continue;
  }
  statements.push(
    `alter role ${role} password '${scramSha256Verifier(password, { salt: stableSalt(role, password) })}';`,
  );
}

if (errors.length > 0) {
  console.error(`role-passwords: ${errors.join('\n  ')}`);
  process.exit(1);
}
if (statements.length === 0) {
  console.error('role-passwords: no passwords provided; nothing to change');
} else {
  process.stdout.write(`${statements.join('\n')}\n`);
}
