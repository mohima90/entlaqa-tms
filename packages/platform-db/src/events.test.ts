import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { emitEvent } from './events';

const dialect = new PgDialect();

function fakeTx(result: unknown[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        const q = dialect.sqlToQuery(query);
        executed.push({ sql: q.sql, params: q.params });
        return Promise.resolve(result);
      },
    } as never,
  };
}

describe('emitEvent', () => {
  it('inserts a thin event into the outbox with a fresh id and returns it', async () => {
    const fake = fakeTx([]);
    const id = await emitEvent(fake.tx, {
      type: 'com.entlaqa.platform.invitation.created',
      subject: '11111111-1111-4111-8111-111111111111',
      data: { invitation_id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fake.executed[0]?.sql).toContain('insert into platform.event_outbox');
    expect(fake.executed[0]?.sql).not.toContain('returning');
    expect(fake.executed[0]?.params).toEqual([
      id,
      'com.entlaqa.platform.invitation.created',
      1,
      '11111111-1111-4111-8111-111111111111',
      '{"invitation_id":"11111111-1111-4111-8111-111111111111"}',
      null,
    ]);
  });

  it('refuses a malformed type before reaching the database', async () => {
    const fake = fakeTx([]);
    for (const type of ['invitation.created', 'com.entlaqa.Platform.x.y', 'com.entlaqa.a.b']) {
      await expect(emitEvent(fake.tx, { type })).rejects.toThrow('invalid event type');
    }
    await expect(
      emitEvent(fake.tx, { type: `com.entlaqa.a.b.${'c'.repeat(200)}` }),
    ).rejects.toThrow('invalid event type');
    expect(fake.executed).toHaveLength(0);
  });
});
