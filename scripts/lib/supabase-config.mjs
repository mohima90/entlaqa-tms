/**
 * ADR 0002 §5: tenant data is never reachable through the Supabase Data API (PostgREST / pg_graphql).
 * Server code uses a direct connection (withUserTx); the browser uses Supabase only for Realtime.
 * So supabase/config.toml must either disable the Data API or expose NO schema — in particular not
 * `public` (Supabase's default) or any platform/module schema. Exposing a schema later requires an ADR
 * revision and an entry in EXPOSABLE_SCHEMAS.
 */
export const EXPOSABLE_SCHEMAS = new Set();

/** Minimal reader for the `[api]` table of config.toml (`key = value` lines until the next table). */
function readApiTable(toml) {
  const values = {};
  let inApi = false;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (line === '' || line.startsWith('#')) continue;
    const table = /^\[([^\]]+)\]$/.exec(line);
    if (table) {
      inApi = table[1].trim() === 'api';
      continue;
    }
    if (!inApi) continue;
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (kv) values[kv[1]] = kv[2].trim();
  }
  return values;
}

/**
 * @param {string} toml contents of supabase/config.toml
 * @returns {string[]} violations
 */
export function checkSupabaseApiConfig(toml) {
  const api = readApiTable(toml);
  const errors = [];
  if (api.enabled !== 'false') {
    errors.push('supabase/config.toml: [api] enabled must be false (ADR 0002 §5: no Data API)');
  }
  if (api.schemas !== undefined) {
    const list = /^\[(.*)\]$/.exec(api.schemas);
    const schemas = list
      ? list[1]
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      : [api.schemas];
    for (const schema of schemas) {
      if (!EXPOSABLE_SCHEMAS.has(schema)) {
        errors.push(
          `supabase/config.toml: schema "${schema}" must not be exposed through the Data API`,
        );
      }
    }
  }
  return errors;
}
