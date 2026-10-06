import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  claimEmailDelivery,
  discardInactiveTenantDelivery,
  finishEmailDelivery,
  insertEmailDelivery,
} from './deliveries';

const dialect = new PgDialect();
const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';

/** Answers each statement with the next result (the last one repeats). */
function fakeTx(...results: unknown[][]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        executed.push(dialect.sqlToQuery(query));
        return Promise.resolve(results[Math.min(executed.length, results.length) - 1] ?? []);
      },
    } as never,
  };
}

describe('message delivery helpers', () => {
  it('queues an e-mail with its content and returns the id', async () => {
    const fake = fakeTx([{ id: ID }]);
    const id = await insertEmailDelivery(fake.tx, {
      template: 'platform.invitation',
      templateVersion: 1,
      locale: 'ar',
      destination: 'sara@example.com',
      destinationMasked: 's***@example.com',
      subject: 'دعوة',
      html: '<p>x</p>',
      text: 'x',
    });
    expect(id).toBe(ID);
    expect(fake.executed[0]?.params).toEqual([
      'platform.invitation',
      1,
      'ar',
      null,
      'sara@example.com',
      's***@example.com',
      'دعوة',
      '<p>x</p>',
      'x',
      null,
    ]);
    await expect(
      insertEmailDelivery(fakeTx([]).tx, {
        template: 't.x',
        templateVersion: 1,
        locale: 'en',
        destination: 'a@b.c',
        destinationMasked: 'a***@b.c',
        subject: 's',
        html: 'h',
        text: 't',
      }),
    ).rejects.toThrow('no row returned');
  });

  it('claims a waiting delivery; nothing when final or unknown; busy while another sender holds it', async () => {
    const row = {
      id: ID,
      destination: 'sara@example.com',
      subject: 's',
      html_body: 'h',
      text_body: 't',
      attempts: 2,
    };
    const fake = fakeTx([{ status: 'queued', leased: false }], [row]);
    expect(await claimEmailDelivery(fake.tx, ID)).toEqual({
      id: ID,
      destination: 'sara@example.com',
      subject: 's',
      html: 'h',
      text: 't',
      attempts: 2,
    });
    expect(fake.executed[0]?.sql).toContain('for update');
    expect(fake.executed[0]?.params).toEqual([300, ID]);
    expect(fake.executed[1]?.sql).toContain("status = 'sending', attempts = attempts + 1");
    // A sender that died: claimed again once its lease ran out.
    expect(
      await claimEmailDelivery(fakeTx([{ status: 'sending', leased: false }], [row]).tx, ID),
    ).toMatchObject({ id: ID });
    expect(await claimEmailDelivery(fakeTx([{ status: 'sending', leased: true }]).tx, ID)).toBe(
      'busy',
    );
    expect(await claimEmailDelivery(fakeTx([{ status: 'sent', leased: true }]).tx, ID)).toBeNull();
    expect(await claimEmailDelivery(fakeTx([]).tx, ID)).toBeNull();
    await expect(
      claimEmailDelivery(fakeTx([{ status: 'queued', leased: false }], []).tx, ID),
    ).rejects.toThrow('could not be claimed');
  });

  it('records the outcome; final outcomes remove the content', async () => {
    const sent = fakeTx([{ id: ID }]);
    await finishEmailDelivery(sent.tx, ID, {
      status: 'sent',
      provider: 'resend',
      providerMessageId: 'msg_1',
    });
    expect(sent.executed[0]?.sql).toContain('html_body = null');
    expect(sent.executed[0]?.sql).toContain('now()');
    expect(sent.executed[0]?.params).toEqual(['sent', 'resend', 'msg_1', null, ID]);

    const failed = fakeTx([{ id: ID }]);
    await finishEmailDelivery(failed.tx, ID, { status: 'failed', errorCode: 'ADDRESS_REJECTED' });
    expect(failed.executed[0]?.params).toEqual(['failed', null, null, 'ADDRESS_REJECTED', ID]);

    const retry = fakeTx([{ id: ID }]);
    await finishEmailDelivery(retry.tx, ID, { status: 'retry', errorCode: 'PROVIDER_UNAVAILABLE' });
    expect(retry.executed[0]?.sql).toContain("status = 'queued'");
    expect(retry.executed[0]?.sql).not.toContain('html_body = null');
  });

  it('refuses to record an outcome for a delivery no longer being sent', async () => {
    await expect(
      finishEmailDelivery(fakeTx([]).tx, ID, {
        status: 'sent',
        provider: 'smtp',
        providerMessageId: null,
      }),
    ).rejects.toThrow('no longer being sent');
    await expect(
      finishEmailDelivery(fakeTx([]).tx, ID, { status: 'retry', errorCode: 'NETWORK_ERROR' }),
    ).rejects.toThrow('no longer being sent');
  });

  it("discards a suspended organization's waiting delivery through the database function", async () => {
    const fake = fakeTx([{ discarded: true }]);
    expect(await discardInactiveTenantDelivery(fake.tx, ID)).toBe(true);
    expect(fake.executed[0]?.sql).toContain('private.discard_inactive_tenant_delivery');
    expect(fake.executed[0]?.params).toEqual([ID]);
    expect(await discardInactiveTenantDelivery(fakeTx([{ discarded: false }]).tx, ID)).toBe(false);
    expect(await discardInactiveTenantDelivery(fakeTx([]).tx, ID)).toBe(false);
  });
});
