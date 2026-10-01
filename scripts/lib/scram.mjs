// SCRAM-SHA-256 password verifiers for PostgreSQL login roles (RFC 5802 / RFC 7677, the format
// PostgreSQL stores in pg_authid.rolpassword). `ALTER ROLE … PASSWORD '<verifier>'` stores it as is, so
// the clear-text password never reaches the server, its statement logs or pg_stat_statements.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** PostgreSQL's default `scram_iterations`. */
export const SCRAM_ITERATIONS = 4096;

/**
 * Passwords are restricted to printable ASCII without spaces or quotes: SASLprep (RFC 4013) is then the
 * identity, so the verifier matches what libpq computes on login, and the value survives copy/paste
 * into secret stores and connection URLs.
 */
const PASSWORD_PATTERN = /^[\x21-\x7e]+$/;
const MIN_LENGTH = 32;

/** Returns a list of problems with `password` (empty when acceptable). */
export function checkPassword(password) {
  const problems = [];
  if (typeof password !== 'string' || password.length === 0) return ['is empty'];
  if (password.length < MIN_LENGTH) problems.push(`must be at least ${MIN_LENGTH} characters`);
  if (!PASSWORD_PATTERN.test(password)) {
    problems.push('must contain only printable ASCII characters (no spaces)');
  }
  if (/["'\\]/.test(password)) problems.push('must not contain quotes or backslashes');
  return problems;
}

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/**
 * Builds `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>` (all base64).
 * `salt` defaults to 16 random bytes (PostgreSQL's default length); pass it only in tests.
 */
export function scramSha256Verifier(
  password,
  { salt = randomBytes(16), iterations = SCRAM_ITERATIONS } = {},
) {
  const problems = checkPassword(password);
  if (problems.length > 0) throw new Error(`password ${problems.join('; ')}`);
  const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const storedKey = createHash('sha256').update(hmac(salted, 'Client Key')).digest();
  const serverKey = hmac(salted, 'Server Key');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
