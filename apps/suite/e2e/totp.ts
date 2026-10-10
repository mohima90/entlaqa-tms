import { createHmac } from 'node:crypto';

/**
 * Authenticator codes for the E2E journeys (FR-IAM-12, T-M2-10): RFC 6238 TOTP computed from the set-up
 * key the page shows (or the smoke test passes), as an authenticator app does. Keys stay in memory.
 */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 6238 TOTP (HMAC-SHA-1, 30-second steps, 6 digits) of a base32 key at a time step. */
export function totp(key: string, step: number): string {
  let bits = '';
  for (const char of key.toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error('the set-up key is not base32');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest.readUInt8(digest.length - 1) & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const lastStep = new Map<string, number>();

/**
 * A code from a time step not used before with this key, and not about to expire: an app shows one code
 * per 30 seconds, so a second use in the same step waits for the next one, as a person would.
 */
export async function freshCode(key: string): Promise<string> {
  const used = lastStep.get(key) ?? -1;
  for (;;) {
    const now = Date.now();
    const step = Math.floor(now / 30_000);
    if (step > used && now % 30_000 < 26_000) {
      lastStep.set(key, step);
      return totp(key, step);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** A well-formed code that is certainly not the current one (a typo). */
export function wrongCode(key: string): string {
  const step = Math.floor(Date.now() / 30_000);
  return String((Number(totp(key, step)) + 500_000) % 1_000_000).padStart(6, '0');
}
