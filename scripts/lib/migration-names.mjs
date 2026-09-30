/**
 * Migration naming convention (ADR 0001 "Database ownership"):
 *   YYYYMMDDHHMMSS_<schema>__<description>.sql
 * <schema> must be `platform`, `private`, or a module schema (modules/<name> → <name> with - → _).
 * Timestamps must be valid, unique and strictly increasing in file order.
 */
const NAME_RE = /^(\d{14})_([a-z][a-z0-9_]*?)__([a-z0-9][a-z0-9_]*)\.sql$/;

function validTimestamp(ts) {
  const [y, mo, d, h, mi, s] = [
    ts.slice(0, 4),
    ts.slice(4, 6),
    ts.slice(6, 8),
    ts.slice(8, 10),
    ts.slice(10, 12),
    ts.slice(12, 14),
  ].map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    y >= 2026 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

/**
 * @param {string[]} files file names in supabase/migrations
 * @param {string[]} allowedSchemas
 * @returns {string[]} errors
 */
export function checkMigrationNames(files, allowedSchemas) {
  const errors = [];
  const seen = new Set();
  let previous = '';
  for (const file of [...files].sort()) {
    if (file === '.gitkeep') continue;
    const match = NAME_RE.exec(file);
    if (!match) {
      errors.push(
        `${file}: must match YYYYMMDDHHMMSS_<schema>__<description>.sql (lower-case, underscores)`,
      );
      continue;
    }
    const [, ts, schema] = match;
    if (!validTimestamp(ts)) errors.push(`${file}: invalid timestamp ${ts}`);
    if (!allowedSchemas.includes(schema)) {
      errors.push(`${file}: unknown schema "${schema}" (allowed: ${allowedSchemas.join(', ')})`);
    }
    if (seen.has(ts)) errors.push(`${file}: duplicate timestamp ${ts}`);
    if (ts <= previous && !seen.has(ts)) errors.push(`${file}: timestamp must increase`);
    seen.add(ts);
    previous = ts;
  }
  return errors;
}

export function schemasFromModules(moduleDirs) {
  return ['platform', 'private', ...moduleDirs.map((d) => d.replaceAll('-', '_'))];
}

/**
 * Every migration needs a rollback of the same name in supabase/rollbacks (migration-conventions.md §6),
 * and every rollback must belong to a migration.
 * @returns {string[]} errors
 */
export function checkRollbacks(migrationFiles, rollbackFiles) {
  const migrations = new Set(migrationFiles.filter((f) => f.endsWith('.sql')));
  const rollbacks = new Set(rollbackFiles.filter((f) => f.endsWith('.sql')));
  const errors = [];
  for (const m of migrations)
    if (!rollbacks.has(m)) errors.push(`${m}: missing supabase/rollbacks/${m}`);
  for (const r of rollbacks)
    if (!migrations.has(r)) errors.push(`rollbacks/${r}: no matching migration`);
  return errors;
}
