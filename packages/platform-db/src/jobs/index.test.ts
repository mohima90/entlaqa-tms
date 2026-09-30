import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from '../client';
import { createWithSystemTx, systemClaims } from './index';

const dialect = new PgDialect();
const TENANT = '22222222-2222-4222-8222-222222222222';

describe('withSystemTx (ADR 0002 §7)', () => {
  it('sets role authenticated and a system-actor claim set for one tenant', async () => {
    const executed: { sql: string; params: unknown[] }[] = [];
    const tx = {
      execute: (q: SQL) => {
        executed.push(dialect.sqlToQuery(q));
        return Promise.resolve([]);
      },
    };
    const db = {
      transaction: (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    } as unknown as AppDatabase;
    const withSystemTx = createWithSystemTx(() => db);

    await withSystemTx({ tenantId: TENANT, jobId: 'notifications.dispatch' }, () =>
      Promise.resolve(),
    );

    expect(executed[0]?.sql).toBe('set local role authenticated');
    expect(JSON.parse(String(executed[1]?.params[0]))).toEqual({
      role: 'system',
      tenant_id: TENANT,
      job_id: 'notifications.dispatch',
    });
  });

  it('rejects invalid actors before touching the database', () => {
    expect(() => systemClaims({ tenantId: 'tenant-a', jobId: 'x' })).toThrow(
      'invalid system actor',
    );
    expect(() => systemClaims({ tenantId: TENANT, jobId: '  ' })).toThrow('invalid system actor');
  });
});
