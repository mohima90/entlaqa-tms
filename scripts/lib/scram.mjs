// SCRAM-SHA-256 password verifiers for PostgreSQL login roles (RFC 5802 / RFC 7677, the format
// PostgreSQL stores in pg_authid.rolpassword). `ALTER ROLE … PASSWORD '<verifier>'` stores it as is, so
// the clear-text password never reaches the server. The verifier itself is still sensitive (with a
// captured SCRAM exchange it allows login): it may be retained by pg_stat_statements on the server.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** PostgreSQL's default `scram_iterations`. */
export const SCRAM_ITERATIONS = 4096;

/**
 * Passwords are URL-safe (letters, digits, `-`, `_`) and at least 40 characters: SASLprep (RFC 4013) is
 * then the identity, so the verifier matches what libpq computes on login, and the value can be placed in
 * a connection URL without percent-encoding (docs/engineering/db-deploy.md).
 */
const PASSWORD_PATTERN = /^[A-Za-z0-9_-]+$/;
const MIN_LENGTH = 40;

/** Returns a list of problems with `password` (empty when acceptable). */
export function checkPassword(password) {
  const problems = [];
  if (typeof password !== 'string' || password.length === 0) return ['is empty'];
  if (password.length < MIN_LENGTH) problems.push(`must be at least ${MIN_LENGTH} characters`);
  if (!PASSWORD_PATTERN.test(password)) {
    problems.push('must contain only letters, digits, "-" and "_"');
  }
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
