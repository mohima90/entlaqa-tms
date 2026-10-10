import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STEP_UP_MAX_AGE_SECONDS, codeIsFresh, codeVerifiedAt } from './step-up';

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe('step-up freshness (PO answer: 15 minutes)', () => {
  it('is fifteen minutes, in one place', () => {
    expect(STEP_UP_MAX_AGE_SECONDS).toBe(900);
  });

  it("reads the newest authenticator code from the token's amr claim", () => {
    const claims = {
      amr: [
        { method: 'password', timestamp: at('2026-10-09T08:00:00Z') },
        { method: 'totp', timestamp: at('2026-10-09T08:01:00Z') },
        { method: 'totp', timestamp: at('2026-10-09T08:05:00Z') },
        { method: 'totp', timestamp: 'later' },
        null,
      ],
    };
    expect(codeVerifiedAt(claims)).toEqual(new Date('2026-10-09T08:05:00Z'));
    expect(codeVerifiedAt({ amr: [{ method: 'password', timestamp: 1 }] })).toBeNull();
    expect(codeVerifiedAt({ amr: 'totp' })).toBeNull();
    expect(codeVerifiedAt({})).toBeNull();
  });

  it('accepts a code from the last 15 minutes only', () => {
    const claims = { amr: [{ method: 'totp', timestamp: at('2026-10-09T08:00:00Z') }] };
    expect(codeIsFresh(claims, new Date('2026-10-09T08:15:00Z'))).toBe(true);
    expect(codeIsFresh(claims, new Date('2026-10-09T08:15:01Z'))).toBe(false);
    expect(codeIsFresh(claims, new Date('2026-10-09T07:59:58Z'))).toBe(true);
    expect(codeIsFresh({}, new Date())).toBe(false);
  });
});

describe('the database checks the same 15 minutes (T-M2-10 re-review)', () => {
  it('private.step_up_max_age() equals STEP_UP_MAX_AGE_SECONDS (drift check)', () => {
    const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url).pathname;
    const definitions = readdirSync(migrationsDir)
      .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
      .flatMap((text) => [
        ...text.matchAll(
          /function private\.step_up_max_age\(\)[\s\S]*?as \$\$ select interval '(\d+) minutes' \$\$/g,
        ),
      ]);
    expect(definitions).toHaveLength(1);
    expect(Number(definitions[0]?.[1]) * 60).toBe(STEP_UP_MAX_AGE_SECONDS);
  });
});
