import type { ActorContext } from '@jadarat/platform-core';
import { describe, expect, it } from 'vitest';
import { insertAuditEvent } from './audit';
import { auditEvents } from './schema/platform';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  personId: '44444444-4444-4444-8444-444444444444',
  tenantId: '22222222-2222-4222-8222-222222222222',
  aal: 'aal1',
  impersonatorUserId: null,
} as unknown as ActorContext;

function fakeTx() {
  const inserted: { table: unknown; values: unknown }[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserted.push({ table, values });
        return Promise.resolve();
      },
    }),
  };
  return { tx: tx as never, inserted };
}

describe('insertAuditEvent', () => {
  it('writes the verified actor and the record into platform.audit_events', async () => {
    const { tx, inserted } = fakeTx();
    await insertAuditEvent(tx, actor, {
      action: 'platform.auth.signed_in',
      entityType: 'session',
      entityId: 'abc',
      data: { method: 'password' },
    });
    expect(inserted).toEqual([
      {
        table: auditEvents,
        values: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          actorPersonId: actor.personId,
          impersonatorUserId: null,
          action: 'platform.auth.signed_in',
          entityType: 'session',
          entityId: 'abc',
          data: { method: 'password' },
        },
      },
    ]);
  });

  it('defaults optional fields', async () => {
    const { tx, inserted } = fakeTx();
    await insertAuditEvent(tx, actor, { action: 'platform.auth.signed_out' });
    expect(inserted[0]?.values).toMatchObject({ entityType: null, entityId: null, data: {} });
  });
});
