// Splits a PostgreSQL connection URL into libpq parts for scripts/db-deploy.sh, so the password never
// appears in process arguments or in libpq/psql error messages (which echo malformed URL fragments).
// Error messages produced here never include any part of the URL.

const HOST = /^[A-Za-z0-9.-]{1,253}$/;
const USER = /^[A-Za-z0-9_.-]{1,128}$/;
const DATABASE = /^[A-Za-z0-9_-]{1,63}$/;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Escapes a pgpass field (`:` and `\`). */
const pgpassField = (value) => value.replace(/[\\:]/g, (c) => `\\${c}`);

/**
 * Parses `url` into `{ host, port, user, database, password, passwordForms }`.
 * Query parameters are rejected: TLS settings are controlled by the deploy script, not the URL.
 * Throws an Error with a generic message on any problem.
 */
export function parseDatabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      'DATABASE_URL is not a valid URL (check that special characters in the password are percent-encoded)',
    );
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL must start with postgresql://');
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new Error(
      'DATABASE_URL must not contain query parameters or a fragment (TLS is set by the deploy script)',
    );
  }
  let user;
  let password;
  let database;
  try {
    user = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
    database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres';
  } catch {
    throw new Error('DATABASE_URL contains an invalid percent-encoding');
  }
  const host = parsed.hostname;
  const port = parsed.port === '' ? '5432' : parsed.port;
  if (!HOST.test(host)) throw new Error('DATABASE_URL host is missing or invalid');
  if (!USER.test(user)) throw new Error('DATABASE_URL user is missing or invalid');
  if (!DATABASE.test(database)) throw new Error('DATABASE_URL database name is invalid');
  if (password === '') throw new Error('DATABASE_URL has no password');
  if ([...password].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) {
    throw new Error('DATABASE_URL password contains control characters');
  }
  return {
    host,
    port,
    user,
    database,
    password,
    isLocal: LOCAL_HOSTS.has(host),
    // Every form the password may take in logs, for GitHub's ::add-mask::.
    passwordForms: [...new Set([password, parsed.password])],
  };
}

/** One pgpass line for the parsed connection. */
export function pgpassLine({ host, port, database, user, password }) {
  return [host, port, database, user, password].map(pgpassField).join(':');
}
