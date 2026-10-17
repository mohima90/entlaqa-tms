import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from './client';
import { REQUIRED_DATABASE_FUNCTIONS, checkDatabase } from './health';

const MIGRATIONS = join(import.meta.dirname, '../../../supabase/migrations');

/**
 * Every `private.name(…)` signature the migrations define, as oidvectortypes prints it: the IN argument
 * types only (OUT parameters and defaults dropped).
 */
function migrationSignatures(): Set<string> {
  const found = new Set<string>();
  const create = /create\s+or\s+replace\s+function\s+private\.(\w+)\s*\(([^)]*)\)/gi;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const text = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const [, name, args = ''] of text.matchAll(create)) {
      const types = args
        .split(',')
        .map((a) => a.replace(/\s+default\s+.*$/is, '').trim())
        .filter((a) => a !== '' && !/^out\s/i.test(a))
        .map(
          (a) =>
            a
              .replace(/^(in|inout)\s+/i, '')
              .split(/\s+/)
              .slice(1)
              .join(' ') || a,
        )
        .map((t) => t.toLowerCase());
      found.add(`${name ?? ''}(${types.join(', ')})`);
    }
  }
  return found;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeDb(query: () => Promise<unknown>, cancel = vi.fn()): () => AppDatabase {
  return () => ({ $client: () => Object.assign(query(), { cancel }) }) as unknown as AppDatabase;
}

describe('REQUIRED_DATABASE_FUNCTIONS', () => {
  it('names functions the migrations define, with their exact signatures', () => {
    const defined = migrationSignatures();
    for (const signature of REQUIRED_DATABASE_FUNCTIONS) expect(defined).toContain(signature);
  });

  it('includes what the invitation codes and the platform console call (expand-first deploys)', () => {
    expect(REQUIRED_DATABASE_FUNCTIONS).toEqual(
      expect.arrayContaining([
        'issue_invitation_code(uuid)',
        'invitation_codes(uuid[])',
        'invitation_code_for_mail(uuid)',
        'is_platform_admin()',
        'platform_list_tenants()',
        'platform_admin_invitation_code(uuid)',
        'platform_reissue_admin_code(uuid)',
      ]),
    );
  });

  it('includes what roles and custom roles call (EP-ROLES, review M3)', () => {
    expect(REQUIRED_DATABASE_FUNCTIONS).toEqual(
      expect.arrayContaining([
        'member_permissions(uuid, uuid)',
        'roles_include_privileged(uuid, text[])',
        'actor_may_manage_person_with(uuid, uuid, text[])',
      ]),
    );
  });
});

describe('checkDatabase', () => {
  it('is not configured without a connection URL', async () => {
    vi.stubEnv('DATABASE_URL_APP_SERVER', '');
    await expect(checkDatabase()).resolves.toBe('not-configured');
  });

  it('is ok when the probe query finds every required function', async () => {
    await expect(
      checkDatabase({ getDb: fakeDb(() => Promise.resolve([{ missing: 0 }])) }),
    ).resolves.toBe('ok');
  });

  it('is unavailable while a required function is missing (app deployed before its migration)', async () => {
    await expect(
      checkDatabase({ getDb: fakeDb(() => Promise.resolve([{ missing: 1 }])) }),
    ).resolves.toBe('unavailable');
    await expect(checkDatabase({ getDb: fakeDb(() => Promise.resolve([])) })).resolves.toBe(
      'unavailable',
    );
  });

  it('is unavailable when the query fails, hangs or the handle cannot be created', async () => {
    await expect(
      checkDatabase({ getDb: fakeDb(() => Promise.reject(new Error('refused'))) }),
    ).resolves.toBe('unavailable');
    const cancel = vi.fn(() => {
      throw new Error('already finished');
    });
    await expect(
      checkDatabase({ timeoutMs: 10, getDb: fakeDb(() => new Promise(() => undefined), cancel) }),
    ).resolves.toBe('unavailable');
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(
      checkDatabase({
        getDb: () => {
          throw new Error('bad url');
        },
      }),
    ).resolves.toBe('unavailable');
  });

  it('connects as app_server when configured (unreachable host → unavailable)', async () => {
    vi.stubEnv('DATABASE_URL_APP_SERVER', 'postgres://app_server@127.0.0.1:1/none');
    await expect(checkDatabase({ timeoutMs: 2000 })).resolves.toBe('unavailable');
  });
});
