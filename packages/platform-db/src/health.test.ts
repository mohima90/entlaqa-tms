import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from './client';
import { checkDatabase } from './health';

afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeDb(query: () => Promise<unknown>): () => AppDatabase {
  return () => ({ $client: query }) as unknown as AppDatabase;
}

describe('checkDatabase', () => {
  it('is not configured without a connection URL', async () => {
    vi.stubEnv('DATABASE_URL_APP_SERVER', '');
    await expect(checkDatabase()).resolves.toBe('not-configured');
  });

  it('is ok when the probe query answers', async () => {
    await expect(
      checkDatabase({ getDb: fakeDb(() => Promise.resolve([{ ok: 1 }])) }),
    ).resolves.toBe('ok');
  });

  it('is unavailable when the query fails, hangs or the handle cannot be created', async () => {
    await expect(
      checkDatabase({ getDb: fakeDb(() => Promise.reject(new Error('refused'))) }),
    ).resolves.toBe('unavailable');
    await expect(
      checkDatabase({ timeoutMs: 10, getDb: fakeDb(() => new Promise(() => undefined)) }),
    ).resolves.toBe('unavailable');
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
